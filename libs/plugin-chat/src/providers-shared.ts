// The provider-connection contract both halves of the chat plugin read (#374).
//
// It used to be written twice, a union and a field-rule table in
// `providers.dto.ts`/`providers.service.ts` and a hand-copied twin in
// `ProviderConnections.vue`, each carrying a "keep in sync" comment. The copies
// had already drifted in meaning: the form offered a `custom` type the runtime
// could not call at all. One module now owns the list, the default endpoints,
// the per-type field rules and the failure codes, the same way `proxy-label.ts`
// is shared. It stays framework-free so the Vue bundle can import it.

export const PROVIDER_TYPES = [
  'gemini',
  'openai',
  'anthropic',
  'openrouter',
  'ollama',
  'custom',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export function isProviderType(value: string): value is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(value);
}

// The wire protocol each type speaks. OpenRouter and the custom gateway are
// both OpenAI Chat Completions endpoints; only their defaults and headers
// differ, so they share the OpenAI request builder.
export type ProviderDialect = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export const PROVIDER_DIALECTS: Record<ProviderType, ProviderDialect> = {
  gemini: 'gemini',
  openai: 'openai',
  anthropic: 'anthropic',
  openrouter: 'openai',
  ollama: 'ollama',
  custom: 'openai',
};

// The vendor's own endpoint per type, used when the field is left blank and as
// the reference the proxy-label gate compares against: a `baseUrl` that differs
// from this is the only sign that something of the operator's own sits in front
// of the vendor (#228). `custom` has no vendor, so any address counts as one.
export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434',
  custom: '',
};

// OpenAI vision fidelity: how far the API may downscale an image. "high" is
// needed to read small component markings.
export const IMAGE_DETAILS = ['auto', 'high'] as const;
export type ImageDetail = (typeof IMAGE_DETAILS)[number];

// OpenAI `reasoning_effort`, as the current API defines it. "default" is the
// sentinel for "send nothing" so the model keeps its own default. A level the
// model does not accept is retried without the parameter (see LlmClient), so
// offering the whole range cannot break a turn.
export const REASONING_EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type FieldRule = 'required' | 'optional' | 'hidden';

export interface ProviderFieldRules {
  apiKey: FieldRule;
  baseUrl: FieldRule;
  organizationId: FieldRule;
  imageDetail: FieldRule;
  reasoningEffort: FieldRule;
}

// Which parameters each type actually uses. The model and the name are always
// required, so they are not listed.
//
// There is no API-version field (#374). Anthropic versions its API by date in
// the `anthropic-version` header, and the field showed that date as an
// editable value with no explanation. The request builder is written against
// one version, so the version belongs next to that code, not in a form.
export const PROVIDER_FIELD_RULES: Record<ProviderType, ProviderFieldRules> = {
  gemini: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  openai: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'optional',
    imageDetail: 'optional',
    reasoningEffort: 'optional',
  },
  anthropic: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  openrouter: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  ollama: {
    apiKey: 'hidden',
    baseUrl: 'required',
    organizationId: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  custom: {
    apiKey: 'optional',
    baseUrl: 'required',
    organizationId: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
};

// Why a provider call failed, reduced to what the user has to change. The
// backend classifies; each half renders its own sentence from the code (the
// form under its test button, the chat bubble above its retry). The raw vendor
// text still travels alongside as `detail`, but no longer as the headline.
export const PROVIDER_FAILURE_KINDS = [
  'auth',
  'permission',
  'model',
  'endpoint',
  'billing',
  'rateLimit',
  'overloaded',
  'unreachable',
  'timeout',
  'blockedHost',
  'missingKey',
  'missingBaseUrl',
  'locked',
  'badRequest',
  'unknown',
] as const;
export type ProviderFailureKind = (typeof PROVIDER_FAILURE_KINDS)[number];

export function isProviderFailureKind(
  value: unknown,
): value is ProviderFailureKind {
  return (
    typeof value === 'string' &&
    (PROVIDER_FAILURE_KINDS as readonly string[]).includes(value)
  );
}

// One entry of a connection's own model list (#374). `label` is the vendor's
// display name when it has one. Ids are what gets stored and sent.
export interface ProviderModelOption {
  id: string;
  label?: string;
}

// What the connection test checks, step by step. A key that can list models
// says nothing about whether a chat turn works, so the test only passes on a
// real completion. `chat` is false when no model was given to try.
export type TestConnectionResult =
  | { ok: true; chat: boolean }
  | {
      ok: false;
      stage: 'credentials' | 'chat';
      reason: ProviderFailureKind;
      detail?: string;
    };

export type ListModelsResult =
  | { ok: true; models: ProviderModelOption[] }
  | { ok: false; reason: ProviderFailureKind; detail?: string };
