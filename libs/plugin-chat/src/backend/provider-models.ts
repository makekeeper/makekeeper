import type { ProviderModelOption } from '../providers-shared';
import { dialectOf, resolveBaseUrl } from './provider-wire';

// The model-listing call per provider type, and the parsing of its reply into
// the picker's options (#374). The same call doubles as the credentials step
// of the connection test: it is free, and it fails on a bad key or endpoint
// exactly like a completion would.
//
// Filtering is deliberately conservative: a model is dropped only where the
// vendor's own metadata says it cannot chat, or (OpenAI, whose list carries no
// capability data at all) where its id names a non-chat family. Anything
// dropped by mistake can still be typed by hand.

export function modelListUrl(
  provider: string,
  baseUrl: string | null | undefined,
): string {
  const base = resolveBaseUrl(provider, baseUrl);
  switch (dialectOf(provider)) {
    case 'gemini':
      // pageSize 1000 is the API maximum; the public catalogue is far smaller,
      // so one page is the whole list.
      return `${base}/v1beta/models?pageSize=1000`;
    case 'anthropic':
      // Max page size; `retired` models are excluded by default.
      return `${base}/models?limit=1000`;
    case 'ollama':
      return `${base}/api/tags`;
    default:
      return `${base}/models`;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const strings = (value: unknown): string[] =>
  asArray(value).filter((v): v is string => typeof v === 'string');

const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';

// OpenAI's /models lists every model the key can reach (embeddings, speech,
// images, moderation, legacy completions) with nothing but an id. These
// families are not Chat Completions models.
const OPENAI_NON_CHAT =
  /(embedding|whisper|tts|transcribe|dall-e|gpt-image|image|moderation|davinci|babbage|realtime|audio|search|sora|codex-mini|computer-use)/;
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;

// Names that mark an embedding model in an Ollama library or a gateway's list.
const EMBEDDING = /embed/i;

// Gemini ids that answer generateContent but are not conversational models.
const GEMINI_NON_CHAT = /(embedding|imagen|veo|-tts|aqa|image-generation)/;

const byId = (a: ProviderModelOption, b: ProviderModelOption): number =>
  a.id.localeCompare(b.id);

export function parseModelList(
  provider: string,
  body: unknown,
): ProviderModelOption[] {
  if (!isRecord(body)) return [];
  const models: ProviderModelOption[] = [];

  switch (dialectOf(provider)) {
    case 'gemini':
      for (const m of asArray(body['models'])) {
        if (!isRecord(m)) continue;
        // Gemini returns `supportedGenerationMethods` on the wire; the
        // official SDK renames it `supportedActions`.
        const methods = strings(m['supportedGenerationMethods']);
        if (!methods.includes('generateContent')) continue;
        const id = str(m['name']).replace(/^models\//, '');
        if (!id || GEMINI_NON_CHAT.test(id)) continue;
        models.push({ id, label: str(m['displayName']) || undefined });
      }
      return models.sort(byId);

    case 'anthropic':
      for (const m of asArray(body['data'])) {
        if (!isRecord(m)) continue;
        const id = str(m['id']);
        if (!id || m['lifecycle'] === 'retired') continue;
        models.push({ id, label: str(m['display_name']) || undefined });
      }
      // Anthropic lists newest first, which is the useful order: keep it.
      return models;

    case 'ollama':
      for (const m of asArray(body['models'])) {
        if (!isRecord(m)) continue;
        const id = str(m['name']) || str(m['model']);
        if (!id || EMBEDDING.test(id)) continue;
        models.push({ id });
      }
      return models.sort(byId);

    case 'openai':
      for (const m of asArray(body['data'])) {
        if (!isRecord(m)) continue;
        const id = str(m['id']);
        if (!id) continue;
        if (provider === 'openai') {
          if (!OPENAI_CHAT.test(id) || OPENAI_NON_CHAT.test(id)) continue;
          models.push({ id });
        } else if (provider === 'openrouter') {
          // The agent cannot work without tool calls, and OpenRouter says per
          // model which parameters it accepts and what it outputs.
          const params = strings(m['supported_parameters']);
          const arch = isRecord(m['architecture']) ? m['architecture'] : {};
          const outputs = strings(arch['output_modalities']);
          if (params.length > 0 && !params.includes('tools')) continue;
          if (outputs.length > 0 && !outputs.includes('text')) continue;
          models.push({ id, label: str(m['name']) || undefined });
        } else {
          if (EMBEDDING.test(id)) continue;
          models.push({ id });
        }
      }
      return models.sort(byId);

    default:
      return [];
  }
}
