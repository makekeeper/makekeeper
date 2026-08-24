// Internal shapes for the chat agent loop. These describe the JSON we persist
// in AIChatMessage.content and the minimal slices of each LLM provider response
// that we actually read — so the service can stay free of `any`.

import {
  PermissionLevel,
  ToolConfirmSummary,
} from '@makekeeper/plugin-contract';
import type { ProxyLabelSources } from '../proxy-label';

export type ToolArgs = Record<string, unknown>;

// Persisted-message content prefixes. Human messages are plain text; tool
// call/response/pending/cancelled messages are JSON payloads whose content starts
// with these. Centralized so the several `startsWith` splits (getActivity, search,
// journal) can't drift apart.
export const MESSAGE_PREFIX = {
  // Any structured (non-human) payload — `{"type":…`.
  structured: '{"type":',
  toolCall: '{"type":"tool_call"',
  toolCallPending: '{"type":"tool_call_pending"',
  toolCallCancelled: '{"type":"tool_call_cancelled"',
  toolResponse: '{"type":"tool_response"',
} as const;

export interface ToolCallResult {
  isToolCall: true;
  name: string;
  args: ToolArgs;
  callId?: string;
  // Opaque Gemini 2.5 "thinking" signature that rides on the function-call part. It has
  // to be echoed back verbatim on the same part in every later turn, or Gemini rejects
  // the request with 400 (https://ai.google.dev/gemini-api/docs/thought-signatures).
  // Undefined for OpenAI/Ollama, which don't use it.
  thoughtSignature?: string;
}

export type LlmResult = string | ToolCallResult;

// A failed agent turn surfaced to the client (instead of a 500) so it can show the
// reason and offer a manual retry. `provider`/`status` say whose side failed — e.g.
// the LLM upstream returning 503 — while `message` is the human-readable detail.
export interface AgentTurnError {
  error: true;
  message: string;
  provider?: string;
  status?: number;
}

// Parsed AIChatMessage.content payload (may be plain text, hence all-optional).
export interface StoredMessagePayload {
  type?:
    | 'tool_call'
    | 'tool_call_pending'
    | 'tool_response'
    | 'tool_call_cancelled';
  name?: string;
  args?: ToolArgs;
  response?: unknown;
  // Persisted alongside a tool_call so it can be replayed to Gemini on the next turn.
  // See ToolCallResult.thoughtSignature.
  thoughtSignature?: string;
  // Human-readable confirmation-card summary (resolved names), set on a
  // tool_call_pending so the frontend can render a clear localized sentence.
  summary?: ToolConfirmSummary;
  // True when this pending mutation's data originates from recognition (a
  // vision turn, or a recognition-origin tool) (#72). Drives the "verify what
  // was recognised" hint on the confirmation card; also why the call was gated
  // even if its tool is relaxed to AUTO.
  recognized?: boolean;
  // Agent-loop iteration a tool_call_pending was proposed in (#61), so the
  // confirmed-tool execution reports the real turn number in its stage line.
  turn?: number;
}

// A history row as read by callLLM. `imageData` (a base64 data URL) is only set
// on human user messages and is forwarded to vision-capable providers.
export interface HistoryMessage {
  role: string;
  content: string;
  imageData?: string | null;
}

// ── Provider response slices ────────────────────────────────────────────────

export interface GeminiFunctionCall {
  name: string;
  args: ToolArgs;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  thoughtSignature?: string;
}

export interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface OpenAiToolCall {
  id: string;
  type?: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OllamaResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

// Normalized per-call usage extracted from any provider response, threaded to
// the usage recorder (ticket #55).
export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

// One resolved provider connection, as passed to LlmClient.complete. The full
// AIProviderConfig Prisma row satisfies this at runtime; the identity fields are
// optional because synthetic configs (vision one-shots) may omit a name.
export interface ProviderConfig {
  provider: string;
  apiKey: string | null;
  baseUrl: string | null;
  modelName: string;
  organizationId: string | null;
  apiVersion: string | null;
  // OpenAI vision/reasoning knobs (see ProviderService). null = model default.
  imageDetail: string | null;
  reasoningEffort: string | null;
  // Connection identity, for usage attribution (#55).
  id?: string;
  name?: string | null;
  // Proxy request labelling (#230). Optional because synthetic configs (vision
  // one-shots) may omit them; the full Prisma row satisfies this.
  proxyLabel?: string | null;
  proxyLabelSegments?: string | null;
  proxyHeaderName?: string | null;
}

// Per-request halves of the label that the connection cannot know: who is
// calling and which project the turn belongs to. Resolved by ChatService (which
// has the request context and Prisma) and handed in, so LlmClient stays
// Prisma-free. Derived from the composer's own input shape rather than restated,
// so a new segment cannot be added on one side only.
export type ProxyLabelContext = Omit<ProxyLabelSources, 'label'>;

// Thrown by LlmClient when an upstream provider answers with a non-OK HTTP
// status, so the caller can report which provider failed and with what status
// instead of collapsing every failure into a generic 500.
export class LlmProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

// ── Provider request slices ─────────────────────────────────────────────────

export interface GeminiRequestPart {
  text?: string;
  functionCall?: { name: string; args: ToolArgs };
  functionResponse?: { name: string; response: { output: unknown } };
  inlineData?: { mimeType: string; data: string };
  thoughtSignature?: string;
}

export interface GeminiRequestContent {
  role: string;
  parts: GeminiRequestPart[];
}

export type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'high' } };

export interface OpenAiRequestMessage {
  role: string;
  content: string | null | OpenAiContentPart[];
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OllamaRequestMessage {
  role: string;
  content: string;
  images?: string[];
}

// ── Project AI-history shapes (#59) ─────────────────────────────────────────

// One executed / pending / cancelled agent tool action, reconstructed from the
// persisted tool_call(+response)/tool_call_pending/tool_call_cancelled messages of
// a project's sessions. `permission` is resolved at read time from the live tool
// registry; a tool that has since been removed/renamed resolves to 'unknown'.
export type JournalStatus = 'executed' | 'pending' | 'cancelled';

export interface JournalEntry {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  createdAt: Date;
  toolName: string;
  permission: PermissionLevel | 'unknown';
  status: JournalStatus;
  // Canonical ORef strings of the objects this action touched (from args+result).
  refs: string[];
}

export interface ProjectJournal {
  entries: JournalEntry[];
  summary: {
    byPermission: {
      READ: number;
      WRITE: number;
      DESTRUCTIVE: number;
      unknown: number;
    };
    // De-duplicated ORefs across all shown entries — the "affected objects" strip.
    affectedRefs: string[];
  };
}

export interface SessionListEntry {
  id: string;
  createdAt: Date;
  title: string | null;
  pinned: boolean;
  // Turns counted, and WHICH turns depends on the list this row belongs to: the
  // whole conversation in the panel's flat list, and only this project's turns
  // in a project's AI history (#59) — where the number has to agree with the
  // journal and the usage charts beside it, which filter on the same stamp.
  messageCount: number;
  // The project of this chat's most recent stamped turn (#130). One flat list
  // now holds every conversation, and a title derived from the first message
  // ("Where is the M3 screw box?") does not say which project it was about —
  // this does. Null for a chat whose turns carried no project.
  project: { id: string; name: string } | null;
}

export interface PagedSessions {
  items: SessionListEntry[];
  total: number;
}

export interface MessageSearchHit {
  sessionId: string;
  messageId: string;
  role: string;
  createdAt: Date;
  snippet: string;
  sessionTitle: string | null;
}

export interface MessageSearchResult {
  hits: MessageSearchHit[];
  total: number;
}

export interface UsageDay {
  date: string;
  requests: number;
  tokens: number;
  errors: number;
}

export interface ProjectUsage {
  days: UsageDay[];
  totals: { requests: number; tokens: number; errors: number };
}

// A JSON-schema node we may rewrite for Gemini (uppercased types).
export interface JsonSchemaNode {
  type?: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
}
