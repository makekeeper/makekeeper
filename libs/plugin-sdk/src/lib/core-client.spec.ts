import { CoreClient, type BackgroundTokens } from './core-client';

// The 401-refresh policy: a background token dying mid-flight (grants were
// re-consented, tokens re-minted) is EXPECTED — one refresh, one retry. A
// delegated token is not ours to refresh, and a second 401 surfaces.

const response = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe('CoreClient 401 refresh', () => {
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const makeClient = (opts: {
    refresh?: jest.Mock;
    delegated?: string | null;
  }): CoreClient => {
    let tokens: BackgroundTokens = {
      scoped: [{ scopeId: null, token: 'stale' }],
      instance: null,
    };
    const refresh =
      opts.refresh ??
      jest.fn(async () => {
        tokens = {
          scoped: [{ scopeId: null, token: 'fresh' }],
          instance: null,
        };
      });
    if (opts.refresh) {
      opts.refresh.mockImplementation(async () => {
        tokens = {
          scoped: [{ scopeId: null, token: 'fresh' }],
          instance: null,
        };
      });
    }
    return new CoreClient(
      'http://core',
      () => opts.delegated ?? null,
      () => tokens,
      () => undefined,
      refresh as unknown as () => Promise<unknown>,
    );
  };

  it('refreshes once on 401 and retries with the new token', async () => {
    const refresh = jest.fn();
    const client = makeClient({ refresh });
    fetchMock
      .mockResolvedValueOnce(response(401, { message: 'revoked' }))
      .mockResolvedValueOnce(response(200, { result: [1] }));
    const result = await client.invoke('list_orders');
    expect(result).toEqual([1]);
    expect(refresh).toHaveBeenCalledTimes(1);
    const auth = (n: number): string =>
      (fetchMock.mock.calls[n][1] as { headers: Record<string, string> })
        .headers.authorization;
    expect(auth(0)).toBe('Bearer stale');
    expect(auth(1)).toBe('Bearer fresh');
  });

  it('a second 401 surfaces as the error it is', async () => {
    const refresh = jest.fn();
    const client = makeClient({ refresh });
    fetchMock.mockResolvedValue(response(401, { message: 'no' }));
    await expect(client.invoke('list_orders')).rejects.toThrow(
      'core call failed (401)',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never refreshes for a delegated token', async () => {
    const refresh = jest.fn();
    const client = makeClient({ refresh, delegated: 'user-token' });
    fetchMock.mockResolvedValue(response(401, { message: 'no' }));
    await expect(client.invoke('list_orders')).rejects.toThrow('401');
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
