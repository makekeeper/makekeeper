import {
  classifyNetworkFailure,
  classifyProviderFailure,
  networkFailureDetail,
  parseProviderError,
} from './provider-errors';

// The bodies below are the vendors' documented error envelopes. The Anthropic
// one was captured live from api.anthropic.com (an invalid key, #374); the
// others follow the shapes in the vendors' official SDK type definitions.
const anthropic401 = JSON.stringify({
  type: 'error',
  error: { type: 'authentication_error', message: 'invalid x-api-key' },
  request_id: 'req_1',
});

const classify = (
  status: number,
  body: string,
  call: 'listing' | 'completion' = 'completion',
): string => classifyProviderFailure(status, parseProviderError(body), call);

describe('parseProviderError', () => {
  it('reads the message and the type out of an Anthropic error', () => {
    expect(parseProviderError(anthropic401)).toEqual({
      message: 'invalid x-api-key',
      markers: 'authentication_error',
    });
  });

  it('reads an Ollama string error', () => {
    expect(parseProviderError('{"error":"model \\"x\\" not found"}')).toEqual({
      message: 'model "x" not found',
      markers: '',
    });
  });

  it('caps a non-JSON body (an HTML page from the wrong host)', () => {
    const html = `<html>${'x'.repeat(1000)}</html>`;
    expect(parseProviderError(html).message.length).toBe(300);
  });
});

describe('classifyProviderFailure', () => {
  it('reads a rejected key as auth, whatever the status', () => {
    expect(classify(401, anthropic401)).toBe('auth');
    // Google answers a bad key with 400 INVALID_ARGUMENT.
    expect(
      classify(
        400,
        JSON.stringify({
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        }),
      ),
    ).toBe('auth');
  });

  it('separates a missing model from a wrong endpoint on a 404', () => {
    const openAiModel = JSON.stringify({
      error: {
        message: 'The model `gpt-9` does not exist',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });
    expect(classify(404, openAiModel)).toBe('model');
    expect(classify(404, '<html>Not Found</html>')).toBe('endpoint');
    // On the listing call a 404 can only be the address.
    expect(classify(404, openAiModel, 'listing')).toBe('endpoint');
  });

  it('reads an unknown model on a 400 as a model problem', () => {
    expect(classify(400, '{"error":{"message":"Unknown model: foo"}}')).toBe(
      'model',
    );
  });

  it('maps quota, rate limits, overload and access', () => {
    expect(
      classify(
        429,
        '{"error":{"message":"You exceeded your quota","code":"insufficient_quota"}}',
      ),
    ).toBe('billing');
    expect(classify(429, '{"error":{"type":"rate_limit_error"}}')).toBe(
      'rateLimit',
    );
    expect(classify(529, '{"error":{"type":"overloaded_error"}}')).toBe(
      'overloaded',
    );
    expect(classify(403, '{"error":{"type":"permission_error"}}')).toBe(
      'permission',
    );
  });

  it('falls back to badRequest / unknown', () => {
    expect(classify(422, '{"error":{"message":"bad"}}')).toBe('badRequest');
    expect(classify(500, 'boom')).toBe('unknown');
  });
});

describe('network failures', () => {
  it('reads an abort as a timeout and anything else as unreachable', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyNetworkFailure(abort)).toBe('timeout');
    expect(classifyNetworkFailure(new TypeError('fetch failed'))).toBe(
      'unreachable',
    );
  });

  it('surfaces the socket code from the fetch cause', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
    });
    expect(networkFailureDetail(err)).toBe(
      'ECONNREFUSED: connect ECONNREFUSED',
    );
  });
});
