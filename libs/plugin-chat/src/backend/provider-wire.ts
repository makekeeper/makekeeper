import {
  DEFAULT_BASE_URLS,
  PROVIDER_DIALECTS,
  isProviderType,
  type ProviderDialect,
} from '../providers-shared';

// Request details shared by the chat runtime (LlmClient) and the settings
// probes (ProviderService): the endpoint, the auth headers, the API version.
// Before #374 each side built these on its own, so the test probe could
// authenticate a connection the runtime then failed to call.

// The `anthropic-version` the Anthropic request builder is written against.
// Anthropic versions its API by date. `2026-10-21` is the current version: the
// official TypeScript SDK (@anthropic-ai/sdk 1.3.0) sends it. It differs from
// `2023-06-01` only in fields this client never sends (sampling parameters,
// documents in assistant turns, cited text in user turns), so moving to it
// changes no request. Kept in code on purpose: a version is a contract with the
// request builder, not a user preference (#374).
export const ANTHROPIC_API_VERSION = '2026-10-21';

// OpenRouter's optional app attribution (https://openrouter.ai/docs/api-reference/overview):
// `HTTP-Referer` names the app's site and `X-OpenRouter-Title` its display name,
// which is how requests show up under the app in OpenRouter's rankings and the
// user's activity log. The referer is the public repository, not the instance's
// own address: a self-hosted instance's URL is the operator's to disclose.
export const OPENROUTER_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> =
  {
    'HTTP-Referer': 'https://github.com/makekeeper/makekeeper',
    'X-OpenRouter-Title': 'MakeKeeper',
  };

// Vendor display names, used where a failure names whose side it came from.
// Brand nouns only: `custom` has no brand, so it has no entry here and the
// caller names it through i18n.
const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

export function providerLabel(provider: string): string | undefined {
  return PROVIDER_LABELS[provider];
}

// The dialect for a stored provider string. An unknown string has no dialect,
// which the runtime reports as "not supported" rather than guessing.
export function dialectOf(provider: string): ProviderDialect | null {
  return isProviderType(provider) ? PROVIDER_DIALECTS[provider] : null;
}

// The endpoint actually called: the configured one, else the vendor default,
// without trailing slashes so path joins never produce `//`.
export function resolveBaseUrl(
  provider: string,
  baseUrl: string | null | undefined,
): string {
  const fallback = isProviderType(provider) ? DEFAULT_BASE_URLS[provider] : '';
  return (baseUrl?.trim() || fallback).replace(/\/+$/, '');
}

// The headers that authenticate a request, per type. Written AFTER any
// proxy-label headers by every caller, so a user-named header can never
// displace a key (#224).
export function authHeaders(
  provider: string,
  apiKey: string | null,
  organizationId: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  switch (dialectOf(provider)) {
    case 'gemini':
      // A header, not the `?key=` query parameter: a key in the URL ends up
      // in every proxy and access log on the way. The official SDK does the
      // same.
      if (apiKey) headers['x-goog-api-key'] = apiKey;
      break;
    case 'anthropic':
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = ANTHROPIC_API_VERSION;
      break;
    case 'ollama':
      // A local Ollama takes no key. One placed in front of a remote server
      // behind a proxy is the proxy's business, configured there.
      break;
    case 'openai':
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      if (provider === 'openai' && organizationId) {
        headers['OpenAI-Organization'] = organizationId;
      }
      if (provider === 'openrouter') {
        Object.assign(headers, OPENROUTER_ATTRIBUTION_HEADERS);
      }
      break;
    default:
      break;
  }
  return headers;
}
