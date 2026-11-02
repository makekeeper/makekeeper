import { modelListUrl, parseModelList } from './provider-models';
import { authHeaders } from './provider-wire';

// The reply shapes follow each vendor's model-listing endpoint as described by
// its official SDK types (#374): openai 7.47, @anthropic-ai/sdk 1.3,
// @google/genai 2.32, ollama 0.6.4, @openrouter/sdk 1.5.

describe('modelListUrl', () => {
  it('uses each vendor default and listing path', () => {
    expect(modelListUrl('gemini', null)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    );
    expect(modelListUrl('anthropic', '')).toBe(
      'https://api.anthropic.com/v1/models?limit=1000',
    );
    expect(modelListUrl('openrouter', null)).toBe(
      'https://openrouter.ai/api/v1/models',
    );
    expect(modelListUrl('ollama', 'http://box:11434/')).toBe(
      'http://box:11434/api/tags',
    );
    expect(modelListUrl('custom', 'https://gw.example/v1')).toBe(
      'https://gw.example/v1/models',
    );
  });
});

describe('parseModelList', () => {
  it('keeps only OpenAI chat models', () => {
    const ids = parseModelList('openai', {
      data: [
        { id: 'gpt-5.5' },
        { id: 'o4-mini' },
        { id: 'text-embedding-3-large' },
        { id: 'whisper-1' },
        { id: 'gpt-4o-mini-tts' },
        { id: 'dall-e-3' },
        { id: 'gpt-image-1' },
        { id: 'omni-moderation-latest' },
        { id: 'gpt-4o-realtime-preview' },
      ],
    }).map((m) => m.id);
    expect(ids).toEqual(['gpt-5.5', 'o4-mini']);
  });

  it('keeps Anthropic order and display names, drops retired models', () => {
    expect(
      parseModelList('anthropic', {
        data: [
          {
            id: 'claude-opus-5-5',
            display_name: 'Claude Opus 5.5',
            lifecycle: 'active',
          },
          { id: 'claude-old', display_name: 'Old', lifecycle: 'retired' },
          { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
        ],
      }),
    ).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ]);
  });

  it('keeps Gemini models that answer generateContent, without the prefix', () => {
    expect(
      parseModelList('gemini', {
        models: [
          {
            name: 'models/gemini-flash-latest',
            displayName: 'Gemini Flash Latest',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-embedding-001',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/imagen-4',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    ).toEqual([{ id: 'gemini-flash-latest', label: 'Gemini Flash Latest' }]);
  });

  it('keeps only tool-capable text models from OpenRouter', () => {
    const ids = parseModelList('openrouter', {
      data: [
        {
          id: 'anthropic/claude-sonnet-5.5',
          name: 'Anthropic: Claude Sonnet 5.5',
          supported_parameters: ['tools', 'max_tokens'],
          architecture: { output_modalities: ['text'] },
        },
        {
          id: 'some/no-tools',
          supported_parameters: ['max_tokens'],
          architecture: { output_modalities: ['text'] },
        },
        {
          id: 'some/image-gen',
          supported_parameters: ['tools'],
          architecture: { output_modalities: ['image'] },
        },
      ],
    }).map((m) => m.id);
    expect(ids).toEqual(['anthropic/claude-sonnet-5.5']);
  });

  it('lists Ollama models without embedding ones', () => {
    expect(
      parseModelList('ollama', {
        models: [{ name: 'qwen3:8b' }, { name: 'nomic-embed-text:latest' }],
      }),
    ).toEqual([{ id: 'qwen3:8b' }]);
  });

  it('degrades to an empty list on an unexpected body', () => {
    expect(parseModelList('openai', null)).toEqual([]);
    expect(parseModelList('anthropic', { data: 'nope' })).toEqual([]);
  });
});

describe('authHeaders', () => {
  it('authenticates each vendor its own way', () => {
    expect(authHeaders('gemini', 'k', null)).toEqual({ 'x-goog-api-key': 'k' });
    expect(authHeaders('anthropic', 'k', null)).toEqual({
      'x-api-key': 'k',
      'anthropic-version': '2026-10-21',
    });
    expect(authHeaders('openai', 'k', 'org-1')).toEqual({
      Authorization: 'Bearer k',
      'OpenAI-Organization': 'org-1',
    });
    expect(authHeaders('openrouter', 'k', null)).toEqual({
      Authorization: 'Bearer k',
      'HTTP-Referer': 'https://github.com/makekeeper/makekeeper',
      'X-OpenRouter-Title': 'MakeKeeper',
    });
    expect(authHeaders('custom', null, null)).toEqual({});
    expect(authHeaders('ollama', 'ignored', null)).toEqual({});
  });
});
