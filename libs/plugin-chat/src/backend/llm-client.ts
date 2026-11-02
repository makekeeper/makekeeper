import { Injectable, Logger } from '@nestjs/common';
import {
  AttachmentStorageService,
  PluginI18nService,
  TransliterationService,
} from '@makekeeper/backend-core';
import {
  AgentTool,
  PermissionLevel,
  formatByteSize,
  isPictureAttachment,
} from '@makekeeper/plugin-contract';
import { attachmentRef } from './attachment-ref';
import {
  AnthropicContentBlock,
  AnthropicRequestMessage,
  AnthropicResponse,
  GeminiRequestContent,
  GeminiRequestPart,
  GeminiResponse,
  HistoryMessage,
  JsonSchemaNode,
  LlmProviderError,
  LlmResult,
  LlmUsage,
  OllamaRequestMessage,
  OllamaResponse,
  OpenAiRequestMessage,
  OpenAiResponse,
  ProviderConfig,
  ProxyLabelContext,
  StoredMessagePayload,
  ToolArgs,
} from './chat.types';
import { vendorBaseUrl } from './providers.dto';
import {
  authHeaders,
  dialectOf,
  providerLabel,
  resolveBaseUrl,
} from './provider-wire';
import {
  classifyNetworkFailure,
  classifyProviderFailure,
  networkFailureDetail,
  parseProviderError,
} from './provider-errors';
import {
  LITELLM_TAGS_HEADER,
  composeProxyLabel,
  isProxyEndpoint,
  parseProxyLabelSegments,
  proxyUserAgent,
} from '../proxy-label';

// Attachment URL -> inline base64 image, resolved once per LLM call for vision.
type InlineImageMap = Map<string, { mimeType: string; data: string }>;

// Attachment URL -> the line that tells the model this file exists (#112).
// Only non-image attachments get one: a picture is already in the request as
// pixels, so describing it again would only spend tokens.
type AttachmentNoteMap = Map<string, string>;

// The history as every dialect needs it (#374): tool calls paired with their
// results, everything else reduced to text.
//
// Pairing is what makes native tool calling safe to replay. OpenAI and
// Anthropic both 400 on a tool result with no call right before it (and
// Anthropic on a call with no result right after it), and the agent loop can
// leave exactly that behind: a call to an unregistered tool stores a result
// with no call, and a tool that throws stores a call with no result. Such
// orphans become plain-text notes, which every model reads and no API rejects.
type HistoryEntry =
  | { kind: 'message'; message: HistoryMessage }
  | { kind: 'note'; role: 'user' | 'assistant'; text: string }
  | {
      kind: 'call';
      id: string;
      name: string;
      args: ToolArgs;
      thoughtSignature?: string;
    }
  | { kind: 'result'; id: string; name: string; response: unknown };

const isToolArgs = (value: unknown): value is ToolArgs =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A persisted payload is any JSON object; every field of it is optional and
// read defensively, so the object check is the whole contract.
const isStoredPayload = (value: unknown): value is StoredMessagePayload =>
  isToolArgs(value);

// One tool as it goes into a request body: the localized projection, no handler.
interface RequestTool {
  name: string;
  description: string;
  parameters: JsonSchemaNode;
}

// Everything a dialect builder needs for one call, resolved once up front.
interface DialectContext {
  provider: ProviderConfig;
  // The endpoint without a trailing slash.
  base: string;
  // Whose side failed, as the error names it ("Anthropic", "OpenRouter").
  label: string;
  headers: Record<string, string>;
  systemPrompt: string;
  entries: HistoryEntry[];
  tools: RequestTool[];
  images: InlineImageMap;
  attachmentNotes: AttachmentNoteMap;
  locale?: string;
  onUsage?: (usage: LlmUsage) => Promise<void>;
  signal?: AbortSignal;
}

// Options of one `complete()` call that the agent loop never sets.
interface CompleteOptions {
  // Abort the request (the connection test bounds its probe with this).
  signal?: AbortSignal;
}

// Anthropic requires `max_tokens`. 16000 leaves a thinking model room to
// reason and still answer, and stays well inside the non-streaming request
// time a single HTTP call can afford.
const ANTHROPIC_MAX_TOKENS = 16000;

// The media types Anthropic accepts in an image block. Any other picture is
// left out of the request rather than turning the whole turn into a 400.
const ANTHROPIC_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// The tool the connection test offers (#374). The test has to prove that a
// request WITH tools succeeds, because every agent turn carries them and a
// model or gateway without tool support fails exactly there. It is never
// executed: whatever the model does with it, an HTTP 200 is the pass.
const PROBE_TOOL: AgentTool = {
  name: 'connection_check',
  descriptionKey: 'chat.prompt.connectionProbeTool',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        descriptionKey: 'chat.prompt.connectionProbeToolStatus',
      },
    },
  },
  permission: PermissionLevel.READ,
  pluginId: 'chat',
  pluginLabelKey: 'plugins.chat.name',
  handler: async () => null,
};

// The LLM wire protocol, extracted from ChatService: one `complete()` interface
// over four provider dialects (Gemini / OpenAI Chat Completions / Anthropic
// Messages / Ollama). OpenRouter and the custom gateway speak the OpenAI one.
// Deliberately Prisma-free and side-effect-light — token usage is reported
// through the `onUsage` callback so the caller persists telemetry, which keeps
// this whole unit unit-testable behind a stubbed `fetch`.
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(
    private readonly i18n: PluginI18nService,
    private readonly attachments: AttachmentStorageService,
    private readonly transliteration: TransliterationService,
  ) {}

  async complete(
    provider: ProviderConfig,
    systemPrompt: string,
    history: HistoryMessage[],
    activeTools: AgentTool[],
    locale?: string,
    onUsage?: (usage: LlmUsage) => Promise<void>,
    labelContext?: ProxyLabelContext,
    options?: CompleteOptions,
  ): Promise<LlmResult> {
    const dialect = dialectOf(provider.provider);
    if (!dialect) {
      throw new Error(
        this.i18n.t(
          'chat.errors.providerNotSupported',
          { provider: provider.provider },
          locale,
        ),
      );
    }

    // Built once and spread FIRST into every dialect's header map, so the
    // client's own auth headers are written afterwards and always win. That
    // ordering — not the save-time denylist, which is maintained by hand and
    // will fall behind the code — is what makes a user-named header unable to
    // displace an API key (#224).
    const headers: Record<string, string> = {
      ...this.buildProxyHeaders(provider, labelContext),
      'Content-Type': 'application/json',
      ...authHeaders(
        provider.provider,
        provider.apiKey,
        provider.organizationId,
      ),
    };

    // Resolve any attached images once (from disk) so vision requests can inline them.
    const images = await this.resolveHistoryImages(history);

    // Non-image attachments are announced, never inlined (#112): the model is
    // told a file exists and can pull its text with `read_attachment`.
    const attachmentNotes = await this.resolveAttachmentNotes(history, locale);

    // For the LLM REQUEST only: resolve each tool's i18n descriptionKey (and every
    // parameter's descriptionKey) to the caller's locale. The real `activeTools`
    // keep their handlers for execution (find-by-name below); these localized
    // projections carry no handler and are used solely to build the request body.
    const resolvedTools = activeTools.map((t) =>
      this.i18n.resolveTool(t, locale),
    );

    const entries = this.normalizeHistory(history, locale);
    const ctx: DialectContext = {
      provider,
      base: resolveBaseUrl(provider.provider, provider.baseUrl),
      label:
        providerLabel(provider.provider) ??
        this.i18n.t('providerSettings.customGatewayOption', undefined, locale),
      headers,
      systemPrompt,
      entries,
      tools: resolvedTools.map((rt) => ({
        name: rt.name,
        description: rt.description,
        parameters: rt.parameters,
      })),
      images,
      attachmentNotes,
      locale,
      onUsage,
      signal: options?.signal,
    };

    switch (dialect) {
      case 'gemini':
        return this.completeGemini(ctx);
      case 'anthropic':
        return this.completeAnthropic(ctx);
      case 'ollama':
        return this.completeOllama(ctx);
      case 'openai':
        return this.completeOpenAi(ctx);
    }
  }

  // The connection test's second step (#374): one real, minimal turn with a
  // tool attached, through exactly the code path the agent uses. Listing
  // models only proves the key; this proves the model, the endpoint and the
  // tool support together. Throws an LlmProviderError on failure.
  async probe(
    provider: ProviderConfig,
    locale?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.complete(
      provider,
      this.i18n.t('chat.prompt.connectionProbeSystem', undefined, locale),
      [
        {
          role: 'user',
          content: this.i18n.t(
            'chat.prompt.connectionProbe',
            undefined,
            locale,
          ),
        },
      ],
      [PROBE_TOOL],
      locale,
      undefined,
      undefined,
      { signal },
    );
  }

  // ── History ─────────────────────────────────────────────────────────────

  private normalizeHistory(
    history: HistoryMessage[],
    locale?: string,
  ): HistoryEntry[] {
    const parsed = history.map((message) => ({
      message,
      payload: this.parsePayload(message.content),
    }));
    const entries: HistoryEntry[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const { message, payload } = parsed[i];
      const name = payload?.name ?? '';
      switch (payload?.type) {
        case 'tool_call': {
          const next = parsed[i + 1]?.payload;
          if (next?.type === 'tool_response' && (next.name ?? '') === name) {
            // Synthetic, position-based ids: unique within the conversation
            // and within every vendor's id grammar (`^[a-zA-Z0-9_-]+$`).
            const id = `call_${i}`;
            entries.push({
              kind: 'call',
              id,
              name,
              args: payload.args ?? {},
              thoughtSignature: payload.thoughtSignature,
            });
            entries.push({ kind: 'result', id, name, response: next.response });
            i += 1;
          } else {
            entries.push({
              kind: 'note',
              role: 'assistant',
              text: this.functionCallNote(name, payload.args, locale),
            });
          }
          break;
        }
        case 'tool_response':
          entries.push({
            kind: 'note',
            role: 'user',
            text: this.functionResultNote(payload.response, locale),
          });
          break;
        case 'tool_call_pending':
          entries.push({
            kind: 'note',
            role: 'assistant',
            text: this.pendingToolNote(name, locale),
          });
          break;
        case 'tool_call_cancelled':
          entries.push({
            kind: 'note',
            role: 'assistant',
            text: this.i18n.t(
              'chat.prompt.toolCancelledNote',
              { name },
              locale,
            ),
          });
          break;
        default:
          entries.push({ kind: 'message', message });
      }
    }
    return entries;
  }

  private parsePayload(content: string): StoredMessagePayload | null {
    // Human messages are plain text; only a structured payload starts with `{`.
    if (!content.startsWith('{')) return null;
    try {
      const parsed: unknown = JSON.parse(content);
      return isStoredPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // ── Gemini (generateContent) ────────────────────────────────────────────

  private async completeGemini(ctx: DialectContext): Promise<LlmResult> {
    const url = `${ctx.base}/v1beta/models/${encodeURIComponent(ctx.provider.modelName)}:generateContent`;

    const contents: GeminiRequestContent[] = [];
    for (const entry of ctx.entries) {
      switch (entry.kind) {
        case 'call':
          contents.push({
            role: 'model',
            parts: [
              {
                functionCall: { name: entry.name, args: entry.args },
                // Required by Gemini 2.5+ — replaying a function call without
                // the original thought signature 400s on the next turn.
                thoughtSignature: entry.thoughtSignature,
              },
            ],
          });
          break;
        case 'result':
          // Gemini accepts only `user` and `model` roles; a function response
          // rides on a user turn.
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: entry.name,
                  response: { output: entry.response },
                },
              },
            ],
          });
          break;
        case 'note':
          contents.push({
            role: entry.role === 'user' ? 'user' : 'model',
            parts: [{ text: entry.text }],
          });
          break;
        case 'message':
          contents.push({
            role: entry.message.role === 'user' ? 'user' : 'model',
            parts: this.geminiTextParts(
              entry.message,
              ctx.images,
              ctx.attachmentNotes,
            ),
          });
          break;
      }
    }

    const body: {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: GeminiRequestContent[];
      tools?: unknown[];
    } = {
      // The real system instruction, not a fake user/model exchange carrying
      // the prompt — every current Gemini model supports it.
      systemInstruction: { parts: [{ text: ctx.systemPrompt }] },
      contents,
    };
    if (ctx.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: ctx.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: this.translateSchemaTypesToUppercase(t.parameters),
          })),
        },
      ];
    }

    const response = await this.post(ctx, url, body);
    const resJson: GeminiResponse = await response.json();
    await ctx.onUsage?.({
      promptTokens: resJson.usageMetadata?.promptTokenCount,
      completionTokens: resJson.usageMetadata?.candidatesTokenCount,
      totalTokens: resJson.usageMetadata?.totalTokenCount,
    });
    const parts = resJson.candidates?.[0]?.content?.parts ?? [];
    const callPart = parts.find((p) => p.functionCall);
    if (callPart?.functionCall) {
      return {
        isToolCall: true,
        name: callPart.functionCall.name,
        args: callPart.functionCall.args,
        thoughtSignature: callPart.thoughtSignature,
      };
    }
    const text = parts
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    return text || this.emptyResponse(ctx);
  }

  // ── Anthropic (Messages API) ────────────────────────────────────────────

  private async completeAnthropic(ctx: DialectContext): Promise<LlmResult> {
    const url = `${ctx.base}/messages`;
    const messages: AnthropicRequestMessage[] = [];

    // Consecutive same-role turns are merged: the API combines them anyway,
    // and a tool_result must sit in the user turn directly after its call.
    const push = (
      role: 'user' | 'assistant',
      blocks: AnthropicContentBlock[],
    ): void => {
      if (blocks.length === 0) return;
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else messages.push({ role, content: [...blocks] });
    };
    // Anthropic rejects an empty text block.
    const text = (value: string): AnthropicContentBlock[] =>
      value.trim() ? [{ type: 'text', text: value }] : [];

    for (const entry of ctx.entries) {
      switch (entry.kind) {
        case 'call':
          push('assistant', [
            {
              type: 'tool_use',
              id: entry.id,
              name: entry.name,
              input: entry.args,
            },
          ]);
          break;
        case 'result':
          push('user', [
            {
              type: 'tool_result',
              tool_use_id: entry.id,
              content: JSON.stringify(entry.response ?? null),
            },
          ]);
          break;
        case 'note':
          push(entry.role, text(entry.text));
          break;
        case 'message': {
          const m = entry.message;
          const blocks = text(this.messageText(m, ctx.attachmentNotes));
          const img = m.imageData ? ctx.images.get(m.imageData) : undefined;
          if (
            m.role === 'user' &&
            img &&
            ANTHROPIC_IMAGE_TYPES.has(img.mimeType)
          ) {
            // Image before the text, as Anthropic recommends.
            blocks.unshift({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mimeType,
                data: img.data,
              },
            });
          }
          push(m.role === 'user' ? 'user' : 'assistant', blocks);
          break;
        }
      }
    }

    // No `thinking` parameter: current models think adaptively by default and
    // older ones run without. Thinking blocks in the reply are not stored or
    // replayed. The documented recovery for a history whose thinking blocks
    // cannot be checked is to drop them and keep the text and tool blocks,
    // and this system prompt carries the current time, so a replayed block
    // would never match the conversation it came from anyway.
    const body: {
      model: string;
      max_tokens: number;
      system: string;
      messages: AnthropicRequestMessage[];
      tools?: unknown[];
      tool_choice?: { type: 'auto'; disable_parallel_tool_use: boolean };
    } = {
      model: ctx.provider.modelName,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: ctx.systemPrompt,
      messages,
    };
    if (ctx.tools.length > 0) {
      body.tools = ctx.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { ...t.parameters, type: 'object' },
      }));
      // The agent loop executes one call per step and persists one; a second
      // parallel call would be dropped on the floor.
      body.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
    }

    const response = await this.post(ctx, url, body);
    const resJson: AnthropicResponse = await response.json();
    const usage = resJson.usage;
    const promptTokens =
      usage?.input_tokens !== undefined
        ? usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0)
        : undefined;
    await ctx.onUsage?.({
      promptTokens,
      completionTokens: usage?.output_tokens,
      totalTokens:
        promptTokens !== undefined || usage?.output_tokens !== undefined
          ? (promptTokens ?? 0) + (usage?.output_tokens ?? 0)
          : undefined,
    });

    const blocks = resJson.content ?? [];
    for (const block of blocks) {
      if (block.type === 'tool_use' && 'input' in block && 'name' in block) {
        return {
          isToolCall: true,
          callId: block.id,
          name: block.name,
          args: block.input,
        };
      }
    }
    const reply = blocks
      .map((b) => (b.type === 'text' && 'text' in b ? b.text : ''))
      .join('')
      .trim();
    if (reply) return reply;
    if (resJson.stop_reason === 'refusal') {
      return this.i18n.t(
        'chat.messages.providerRefused',
        undefined,
        ctx.locale,
      );
    }
    return this.emptyResponse(ctx);
  }

  // ── OpenAI Chat Completions (OpenAI, OpenRouter, custom gateways) ───────

  private async completeOpenAi(ctx: DialectContext): Promise<LlmResult> {
    const url = `${ctx.base}/chat/completions`;
    const { imageDetail, reasoningEffort } = ctx.provider;
    // "high" lets the API keep enough resolution to read small component
    // markings; anything else falls back to the API default ("auto").
    const detail: 'auto' | 'high' = imageDetail === 'high' ? 'high' : 'auto';

    const messages: OpenAiRequestMessage[] = [
      { role: 'system', content: ctx.systemPrompt },
    ];
    for (const entry of ctx.entries) {
      switch (entry.kind) {
        case 'call':
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: entry.id,
                type: 'function',
                function: {
                  name: entry.name,
                  arguments: JSON.stringify(entry.args),
                },
              },
            ],
          });
          break;
        case 'result':
          messages.push({
            role: 'tool',
            tool_call_id: entry.id,
            content: JSON.stringify(entry.response ?? null),
          });
          break;
        case 'note':
          messages.push({ role: entry.role, content: entry.text });
          break;
        case 'message':
          messages.push(
            this.openAiTextMessage(
              entry.message,
              ctx.images,
              detail,
              ctx.attachmentNotes,
            ),
          );
          break;
      }
    }

    const body: {
      model: string;
      messages: OpenAiRequestMessage[];
      tools?: unknown[];
      reasoning_effort?: string;
    } = { model: ctx.provider.modelName, messages };
    // Only forward reasoning_effort when the user picked a non-default level;
    // sending it to a non-reasoning model would be rejected.
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    if (ctx.tools.length > 0) {
      body.tools = ctx.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    // Not every OpenAI(-compatible) model accepts reasoning_effort — a
    // non-reasoning model 400s naming the parameter, and a reasoning model may
    // not accept every level. The model's capabilities aren't knowable up front
    // (custom gateways, name variants), so retry once without the parameter
    // instead of failing the whole turn.
    const response = await this.post(ctx, url, body, (status, errText) => {
      if (
        status === 400 &&
        body.reasoning_effort &&
        errText.includes('reasoning_effort')
      ) {
        this.logger.warn(
          `Model ${ctx.provider.modelName} rejected reasoning_effort — retrying without it`,
        );
        delete body.reasoning_effort;
        return body;
      }
      return null;
    });

    const resJson: OpenAiResponse = await response.json();
    await ctx.onUsage?.({
      promptTokens: resJson.usage?.prompt_tokens,
      completionTokens: resJson.usage?.completion_tokens,
      totalTokens: resJson.usage?.total_tokens,
    });
    const message = resJson.choices?.[0]?.message;
    const tc = message?.tool_calls?.[0];
    if (tc) {
      return {
        isToolCall: true,
        callId: tc.id,
        name: tc.function.name,
        args: this.parseArgs(tc.function.arguments),
      };
    }
    return message?.content || this.emptyResponse(ctx);
  }

  // ── Ollama (/api/chat) ──────────────────────────────────────────────────

  private async completeOllama(ctx: DialectContext): Promise<LlmResult> {
    const url = `${ctx.base}/api/chat`;
    // Native tool calling (`tools` + `message.tool_calls`) where the model
    // supports it. Before #374 Ollama got no tools at all, so the agent could
    // talk about the inventory but never touch it.
    const build = (nativeTools: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: ctx.provider.modelName,
        messages: this.ollamaMessages(ctx, nativeTools),
        stream: false,
      };
      if (nativeTools) {
        body['tools'] = ctx.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }
      return body;
    };

    const useTools = ctx.tools.length > 0;
    // A model whose template has no tool support answers 400 "does not
    // support tools". It can still chat, so retry with the tool history as
    // text and no tools — the pre-#374 behaviour, kept as the fallback.
    const response = await this.post(
      ctx,
      url,
      build(useTools),
      (status, errText) => {
        if (
          useTools &&
          status === 400 &&
          /does not support tools/i.test(errText)
        ) {
          this.logger.warn(
            `Ollama model ${ctx.provider.modelName} has no tool support — retrying without tools`,
          );
          return build(false);
        }
        return null;
      },
    );

    const resJson: OllamaResponse = await response.json();
    await ctx.onUsage?.({
      promptTokens: resJson.prompt_eval_count,
      completionTokens: resJson.eval_count,
      totalTokens:
        resJson.prompt_eval_count !== undefined ||
        resJson.eval_count !== undefined
          ? (resJson.prompt_eval_count ?? 0) + (resJson.eval_count ?? 0)
          : undefined,
    });
    const tc = resJson.message?.tool_calls?.[0];
    if (tc) {
      const raw = tc.function.arguments;
      return {
        isToolCall: true,
        name: tc.function.name,
        args: typeof raw === 'string' ? this.parseArgs(raw) : (raw ?? {}),
      };
    }
    return resJson.message?.content || this.emptyResponse(ctx);
  }

  private ollamaMessages(
    ctx: DialectContext,
    nativeTools: boolean,
  ): OllamaRequestMessage[] {
    const messages: OllamaRequestMessage[] = [
      { role: 'system', content: ctx.systemPrompt },
    ];
    for (const entry of ctx.entries) {
      switch (entry.kind) {
        case 'call':
          messages.push(
            nativeTools
              ? {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    { function: { name: entry.name, arguments: entry.args } },
                  ],
                }
              : {
                  role: 'assistant',
                  content: this.functionCallNote(
                    entry.name,
                    entry.args,
                    ctx.locale,
                  ),
                },
          );
          break;
        case 'result':
          messages.push(
            nativeTools
              ? {
                  role: 'tool',
                  tool_name: entry.name,
                  content: JSON.stringify(entry.response ?? null),
                }
              : {
                  role: 'user',
                  content: this.functionResultNote(entry.response, ctx.locale),
                },
          );
          break;
        case 'note':
          messages.push({ role: entry.role, content: entry.text });
          break;
        case 'message':
          messages.push(
            this.ollamaTextMessage(
              entry.message,
              ctx.images,
              ctx.attachmentNotes,
            ),
          );
          break;
      }
    }
    return messages;
  }

  // ── Transport ───────────────────────────────────────────────────────────

  // POST once, optionally retry once with a corrected body, and turn every
  // failure into an LlmProviderError that says what to fix (#374). A request
  // that never got an answer (refused connection, unknown host, timeout) is
  // a provider failure too — it used to escape as a bare "fetch failed".
  private async post(
    ctx: DialectContext,
    url: string,
    body: unknown,
    retryWith?: (status: number, errText: string) => unknown,
  ): Promise<Response> {
    const send = async (payload: unknown): Promise<Response> => {
      try {
        return await fetch(url, {
          method: 'POST',
          headers: ctx.headers,
          body: JSON.stringify(payload),
          signal: ctx.signal,
        });
      } catch (err) {
        throw new LlmProviderError(
          ctx.label,
          0,
          networkFailureDetail(err),
          classifyNetworkFailure(err),
        );
      }
    };

    let response = await send(body);
    if (response.ok) return response;
    let errText = await response.text();
    const retryBody = retryWith?.(response.status, errText) ?? null;
    if (retryBody !== null) {
      response = await send(retryBody);
      if (response.ok) return response;
      errText = await response.text();
    }
    const parsed = parseProviderError(errText);
    throw new LlmProviderError(
      ctx.label,
      response.status,
      parsed.message,
      classifyProviderFailure(response.status, parsed, 'completion'),
    );
  }

  private parseArgs(raw: string): ToolArgs {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isToolArgs(parsed) ? parsed : {};
    } catch {
      // A model that emits broken JSON gets an empty call; the tool's own
      // validation then answers it, which the model can recover from.
      return {};
    }
  }

  private emptyResponse(ctx: DialectContext): string {
    return this.i18n.t(
      'chat.messages.emptyResponse',
      { provider: ctx.label },
      ctx.locale,
    );
  }

  private functionCallNote(
    name: string,
    args: ToolArgs | undefined,
    locale?: string,
  ): string {
    return this.i18n.t(
      'chat.prompt.functionCallNote',
      { name, args: JSON.stringify(args ?? {}) },
      locale,
    );
  }

  private functionResultNote(response: unknown, locale?: string): string {
    return this.i18n.t(
      'chat.prompt.functionResultNote',
      { result: JSON.stringify(response ?? null) },
      locale,
    );
  }

  // Load every image referenced in the history (by its /api/uploads/:id URL)
  // once, as base64, so the sync per-provider builders can inline them.
  private async resolveHistoryImages(
    history: HistoryMessage[],
  ): Promise<InlineImageMap> {
    const map: InlineImageMap = new Map();
    for (const m of history) {
      if (m.role === 'user' && m.imageData && !map.has(m.imageData)) {
        // Reads the vision rendition, generating it on first use (#113): the
        // stored original may be a 12 MP frame, and inlining that would cost
        // tokens and latency for detail no model resolves anyway. Degrades to a
        // smaller rendition rather than ever falling back to the full-size
        // original.
        const img = await this.attachments.readForVisionAsBase64(m.imageData);
        // Only real images are inlined: a non-image attachment (a dragged-in
        // project file) as an image block would 400 the provider request.
        if (img && img.mimeType.startsWith('image/')) {
          map.set(m.imageData, img);
        }
      }
    }
    return map;
  }

  // One model-facing line per non-image attachment in the history (#112).
  //
  // Assembled here, at request-build time, rather than persisted with the
  // message: the wording and the caller's locale stay changeable without a
  // migration, and nothing leaks into the UI, the DB or an exchange export.
  //
  // Metadata only — `findMetaByUrls` reads columns, never bytes. Describing a
  // 200 MB STL must not cost 200 MB of memory, and the filename it returns is
  // what makes the file nameable to the model at all.
  private async resolveAttachmentNotes(
    history: HistoryMessage[],
    locale?: string,
  ): Promise<AttachmentNoteMap> {
    const notes: AttachmentNoteMap = new Map();
    const metas = await this.attachments.findMetaByUrls(
      history.filter((m) => m.role === 'user').map((m) => m.imageData),
    );
    for (const [url, meta] of metas) {
      // A picture is already IN the request as pixels; describing it again
      // would just spend tokens telling the model what it can see.
      if (isPictureAttachment(meta)) continue;
      notes.set(
        url,
        this.i18n.t(
          'chat.prompt.attachedFileNote',
          {
            filename:
              meta.filename ??
              this.i18n.t('chat.attachments.unnamedFile', undefined, locale),
            mimeType: meta.mimeType,
            size: formatByteSize(meta.sizeBytes),
            ref: attachmentRef(meta.id),
          },
          locale,
        ),
      );
    }
    return notes;
  }

  // Headers that identify this request to whatever the operator put in front of
  // the vendor. Empty — the normal case — when no proxy is presumed, no label is
  // configured, or nothing in the label resolved to anything real.
  //
  // Headers ONLY, never a body field. An unknown header is ignored or logged; an
  // unknown body field is not a safe no-op (the "OpenAI/Anthropic 400 on
  // unrecognised fields" claim is widely repeated and never primary-sourced), and
  // the vendors' own identifier fields forbid the human-readable values this
  // whole feature is built on (#223, #228).
  private buildProxyHeaders(
    provider: ProviderConfig,
    context?: ProxyLabelContext,
  ): Record<string, string> {
    // Exactly two conditions, and "a label is configured" is NOT one of them:
    // with the connection segment switchable off, a user- or project-only label
    // is a legitimate configuration, and gating on `proxyLabel` would silently
    // kill it. An empty composition is caught below by `hasContent`.
    if (!isProxyEndpoint(provider.baseUrl, vendorBaseUrl(provider.provider))) {
      return {};
    }

    const composed = composeProxyLabel(
      parseProxyLabelSegments(provider.proxyLabelSegments),
      {
        label: provider.proxyLabel ?? null,
        user: context?.user ?? null,
        project: context?.project ?? null,
      },
      this.transliteration.transliterate,
    );
    // A composition of nothing but placeholders identifies no one — send no
    // header at all rather than a row of `none` in someone's spend report.
    if (!composed.hasContent) return {};

    const headers: Record<string, string> = {
      [LITELLM_TAGS_HEADER]: composed.value,
    };
    // Aperture has no per-request label concept: it attributes by Tailscale
    // identity, and the only client-controlled dimension is a header the TAILNET
    // ADMIN names. MakeKeeper cannot guess it, which is why this field exists.
    if (provider.proxyHeaderName) {
      headers[provider.proxyHeaderName] = composed.value;
    }
    // Aperture's table shows User-Agent without any configuration at all, so
    // the label rides there too — replacing undici's anonymous "node".
    headers['User-Agent'] = proxyUserAgent(composed.value);
    return headers;
  }

  // The text of one history entry as the provider sees it: the user's own
  // words, or — for the empty message that carries an attachment — the note
  // describing that file. Both when a user typed alongside a file.
  private messageText(m: HistoryMessage, notes: AttachmentNoteMap): string {
    const note = m.imageData ? notes.get(m.imageData) : undefined;
    if (!note) return m.content;
    return m.content ? `${m.content}\n\n${note}` : note;
  }

  // Build a plain-text history entry for each provider, attaching the user's
  // image (inline base64) when present (vision).
  private geminiTextParts(
    m: HistoryMessage,
    images: InlineImageMap,
    notes: AttachmentNoteMap,
  ): GeminiRequestPart[] {
    const parts: GeminiRequestPart[] = [{ text: this.messageText(m, notes) }];
    const img = m.imageData ? images.get(m.imageData) : undefined;
    if (img) parts.push({ inlineData: img });
    return parts;
  }

  private openAiTextMessage(
    m: HistoryMessage,
    images: InlineImageMap,
    detail: 'auto' | 'high',
    notes: AttachmentNoteMap,
  ): OpenAiRequestMessage {
    const img = m.imageData ? images.get(m.imageData) : undefined;
    if (m.role === 'user' && img) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: this.messageText(m, notes) },
          {
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType};base64,${img.data}`,
              detail,
            },
          },
        ],
      };
    }
    return {
      role: m.role === 'user' ? 'user' : 'assistant',
      content: this.messageText(m, notes),
    };
  }

  private ollamaTextMessage(
    m: HistoryMessage,
    images: InlineImageMap,
    notes: AttachmentNoteMap,
  ): OllamaRequestMessage {
    const msg: OllamaRequestMessage = {
      role: m.role === 'user' ? 'user' : 'assistant',
      content: this.messageText(m, notes),
    };
    const img = m.imageData ? images.get(m.imageData) : undefined;
    if (img) msg.images = [img.data];
    return msg;
  }

  private translateSchemaTypesToUppercase(
    schema: JsonSchemaNode,
  ): JsonSchemaNode {
    if (!schema) return schema;
    const newSchema: JsonSchemaNode = { ...schema };
    if (newSchema.type) {
      newSchema.type = newSchema.type.toUpperCase();
    }
    if (newSchema.properties) {
      newSchema.properties = { ...newSchema.properties };
      for (const key of Object.keys(newSchema.properties)) {
        newSchema.properties[key] = this.translateSchemaTypesToUppercase(
          newSchema.properties[key],
        );
      }
    }
    if (newSchema.items) {
      newSchema.items = this.translateSchemaTypesToUppercase(newSchema.items);
    }
    return newSchema;
  }

  private pendingToolNote(name?: string, locale?: string): string {
    return this.i18n.t(
      'chat.prompt.pendingToolNote',
      { name: name ?? '' },
      locale,
    );
  }
}
