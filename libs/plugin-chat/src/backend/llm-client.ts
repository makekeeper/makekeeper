import { Injectable, Logger } from '@nestjs/common';
import {
  AttachmentStorageService,
  PluginI18nService,
  TransliterationService,
} from '@makekeeper/backend-core';
import {
  AgentTool,
  formatByteSize,
  isPictureAttachment,
} from '@makekeeper/plugin-contract';
import { attachmentRef } from './attachment-ref';
import {
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
} from './chat.types';
import { vendorBaseUrl } from './providers.dto';
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

// The LLM wire protocol, extracted from ChatService: one `complete()` interface
// over three provider dialects (Gemini / OpenAI / Ollama). Deliberately
// Prisma-free and side-effect-light — token usage is reported through the
// `onUsage` callback so the caller persists telemetry, which keeps this whole
// unit unit-testable behind a stubbed `fetch`.
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
  ): Promise<LlmResult> {
    const {
      provider: providerType,
      apiKey,
      baseUrl,
      modelName,
      organizationId,
      imageDetail,
      reasoningEffort,
    } = provider;

    // Built once and spread FIRST into every dialect's header map, so the
    // client's own auth headers are written afterwards and always win. That
    // ordering — not the save-time denylist, which is maintained by hand and
    // will fall behind the code — is what makes a user-named header unable to
    // displace an API key (#224).
    const proxyHeaders = this.buildProxyHeaders(provider, labelContext);

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

    if (providerType === 'gemini') {
      const url = `${baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const contents: GeminiRequestContent[] = [];
      contents.push({
        role: 'user',
        parts: [
          {
            text: this.i18n.t(
              'chat.prompt.geminiSystemWrapper',
              { systemPrompt },
              locale,
            ),
          },
        ],
      });
      contents.push({
        role: 'model',
        parts: [
          {
            text: this.i18n.t(
              'chat.prompt.geminiPrimingReply',
              undefined,
              locale,
            ),
          },
        ],
      });

      history.forEach((m) => {
        try {
          const data: StoredMessagePayload = JSON.parse(m.content);
          if (data.type === 'tool_call') {
            contents.push({
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: data.name ?? '',
                    args: data.args ?? {},
                  },
                  // Required by Gemini 2.5 — replaying a function call without the
                  // original thought signature triggers a 400 on the next turn.
                  thoughtSignature: data.thoughtSignature,
                },
              ],
            });
          } else if (data.type === 'tool_call_pending') {
            contents.push({
              role: 'model',
              parts: [{ text: this.pendingToolNote(data.name, locale) }],
            });
          } else if (data.type === 'tool_response') {
            contents.push({
              role: 'function',
              parts: [
                {
                  functionResponse: {
                    name: data.name ?? '',
                    response: { output: data.response },
                  },
                },
              ],
            });
          } else if (data.type === 'tool_call_cancelled') {
            contents.push({
              role: 'model',
              parts: [
                {
                  text: this.i18n.t(
                    'chat.prompt.toolCancelledNote',
                    { name: data.name ?? '' },
                    locale,
                  ),
                },
              ],
            });
          } else {
            contents.push({
              role: m.role === 'user' ? 'user' : 'model',
              parts: this.geminiTextParts(m, images, attachmentNotes),
            });
          }
        } catch {
          contents.push({
            role: m.role === 'user' ? 'user' : 'model',
            parts: this.geminiTextParts(m, images, attachmentNotes),
          });
        }
      });

      const body: { contents: GeminiRequestContent[]; tools?: unknown[] } = {
        contents,
      };
      if (resolvedTools.length > 0) {
        body.tools = [
          {
            functionDeclarations: resolvedTools.map((rt) => ({
              name: rt.name,
              description: rt.description,
              parameters: this.translateSchemaTypesToUppercase(rt.parameters),
            })),
          },
        ];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { ...proxyHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new LlmProviderError(
          'Gemini',
          response.status,
          this.extractProviderError(errText),
        );
      }

      const resJson: GeminiResponse = await response.json();
      await onUsage?.({
        promptTokens: resJson.usageMetadata?.promptTokenCount,
        completionTokens: resJson.usageMetadata?.candidatesTokenCount,
        totalTokens: resJson.usageMetadata?.totalTokenCount,
      });
      const candidate = resJson.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      if (part?.functionCall) {
        return {
          isToolCall: true,
          name: part.functionCall.name,
          args: part.functionCall.args,
          thoughtSignature: part.thoughtSignature,
        };
      }

      return (
        part?.text ||
        this.i18n.t(
          'chat.messages.emptyResponse',
          { provider: 'Gemini' },
          locale,
        )
      );
    } else if (providerType === 'openai') {
      const url = `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;

      const messages: OpenAiRequestMessage[] = [
        { role: 'system', content: systemPrompt },
      ];

      // "high" lets the API keep enough resolution to read small component
      // markings; anything else falls back to the API default ("auto").
      const openAiImageDetail: 'auto' | 'high' =
        imageDetail === 'high' ? 'high' : 'auto';

      history.forEach((m) => {
        try {
          const data: StoredMessagePayload = JSON.parse(m.content);
          if (data.type === 'tool_call') {
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_' + data.name,
                  type: 'function',
                  function: {
                    name: data.name ?? '',
                    arguments: JSON.stringify(data.args ?? {}),
                  },
                },
              ],
            });
          } else if (data.type === 'tool_call_pending') {
            messages.push({
              role: 'assistant',
              content: this.pendingToolNote(data.name, locale),
            });
          } else if (data.type === 'tool_response') {
            messages.push({
              role: 'tool',
              tool_call_id: 'call_' + data.name,
              content: JSON.stringify(data.response),
            });
          } else if (data.type === 'tool_call_cancelled') {
            messages.push({
              role: 'assistant',
              content: this.i18n.t(
                'chat.prompt.toolCancelledNote',
                { name: data.name ?? '' },
                locale,
              ),
            });
          } else {
            messages.push(
              this.openAiTextMessage(
                m,
                images,
                openAiImageDetail,
                attachmentNotes,
              ),
            );
          }
        } catch {
          messages.push(
            this.openAiTextMessage(
              m,
              images,
              openAiImageDetail,
              attachmentNotes,
            ),
          );
        }
      });

      const body: {
        model: string;
        messages: OpenAiRequestMessage[];
        tools?: unknown[];
        reasoning_effort?: string;
      } = {
        model: modelName,
        messages,
      };

      // Only forward reasoning_effort when the user picked a non-default level;
      // sending it to a non-reasoning model would be rejected.
      if (reasoningEffort) {
        body.reasoning_effort = reasoningEffort;
      }

      if (resolvedTools.length > 0) {
        body.tools = resolvedTools.map((rt) => ({
          type: 'function',
          function: {
            name: rt.name,
            description: rt.description,
            parameters: rt.parameters,
          },
        }));
      }

      const openAiHeaders: Record<string, string> = {
        ...proxyHeaders,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      // Optional OpenAI org scoping — only sent when the user configured it.
      if (organizationId) {
        openAiHeaders['OpenAI-Organization'] = organizationId;
      }

      let response = await fetch(url, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        // Not every OpenAI(-compatible) model accepts reasoning_effort — a
        // non-reasoning model 400s with "Unrecognized request argument". The
        // model's capabilities aren't knowable up front (custom gateways, name
        // variants), so retry once without the parameter instead of failing the
        // whole turn.
        if (
          response.status === 400 &&
          body.reasoning_effort &&
          errText.includes('reasoning_effort')
        ) {
          this.logger.warn(
            `Model ${modelName} rejected reasoning_effort — retrying without it`,
          );
          delete body.reasoning_effort;
          response = await fetch(url, {
            method: 'POST',
            headers: openAiHeaders,
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            const retryErrText = await response.text();
            throw new LlmProviderError(
              'OpenAI',
              response.status,
              this.extractProviderError(retryErrText),
            );
          }
        } else {
          throw new LlmProviderError(
            'OpenAI',
            response.status,
            this.extractProviderError(errText),
          );
        }
      }

      const resJson: OpenAiResponse = await response.json();
      await onUsage?.({
        promptTokens: resJson.usage?.prompt_tokens,
        completionTokens: resJson.usage?.completion_tokens,
        totalTokens: resJson.usage?.total_tokens,
      });
      const choice = resJson.choices?.[0];
      const message = choice?.message;

      if (message?.tool_calls?.[0]) {
        const tc = message.tool_calls[0];
        return {
          isToolCall: true,
          callId: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        };
      }

      return (
        message?.content ||
        this.i18n.t(
          'chat.messages.emptyResponse',
          { provider: 'OpenAI' },
          locale,
        )
      );
    } else if (providerType === 'ollama') {
      const url = `${baseUrl || 'http://localhost:11434'}/api/chat`;

      const messages: OllamaRequestMessage[] = [
        { role: 'system', content: systemPrompt },
      ];

      history.forEach((m) => {
        try {
          const data: StoredMessagePayload = JSON.parse(m.content);
          if (data.type === 'tool_call') {
            messages.push({
              role: 'assistant',
              content: this.i18n.t(
                'chat.prompt.functionCallNote',
                {
                  name: data.name ?? '',
                  args: JSON.stringify(data.args ?? {}),
                },
                locale,
              ),
            });
          } else if (data.type === 'tool_call_pending') {
            messages.push({
              role: 'assistant',
              content: this.pendingToolNote(data.name, locale),
            });
          } else if (data.type === 'tool_response') {
            messages.push({
              role: 'user',
              content: this.i18n.t(
                'chat.prompt.functionResultNote',
                { result: JSON.stringify(data.response ?? null) },
                locale,
              ),
            });
          } else if (data.type === 'tool_call_cancelled') {
            messages.push({
              role: 'assistant',
              content: this.i18n.t(
                'chat.prompt.toolCancelledNote',
                { name: data.name ?? '' },
                locale,
              ),
            });
          } else {
            messages.push(this.ollamaTextMessage(m, images, attachmentNotes));
          }
        } catch {
          messages.push(this.ollamaTextMessage(m, images, attachmentNotes));
        }
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: { ...proxyHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new LlmProviderError(
          'Ollama',
          response.status,
          this.extractProviderError(errText),
        );
      }

      const resJson: OllamaResponse = await response.json();
      await onUsage?.({
        promptTokens: resJson.prompt_eval_count,
        completionTokens: resJson.eval_count,
        totalTokens:
          resJson.prompt_eval_count !== undefined ||
          resJson.eval_count !== undefined
            ? (resJson.prompt_eval_count ?? 0) + (resJson.eval_count ?? 0)
            : undefined,
      });
      return (
        resJson.message?.content ||
        this.i18n.t(
          'chat.messages.emptyResponse',
          { provider: 'Ollama' },
          locale,
        )
      );
    }

    throw new Error(
      this.i18n.t(
        'chat.errors.providerNotSupported',
        { provider: providerType },
        locale,
      ),
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

  private extractProviderError(body: string): string {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
        const err = (parsed as { error: unknown }).error;
        if (typeof err === 'string') return err;
        if (typeof err === 'object' && err !== null && 'message' in err) {
          const message = (err as { message: unknown }).message;
          if (typeof message === 'string') return message;
        }
      }
    } catch {
      // Body wasn't JSON — return it verbatim below.
    }
    return body;
  }

  private pendingToolNote(name?: string, locale?: string): string {
    return this.i18n.t(
      'chat.prompt.pendingToolNote',
      { name: name ?? '' },
      locale,
    );
  }
}
