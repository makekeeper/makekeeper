import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiDownload,
  apiFetch,
  apiJson,
  setApiLocaleProvider,
  setApiUnauthorizedHandler,
  setStoredScopeId,
  setStoredToken,
} from './api';

describe('apiFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    setApiLocaleProvider(() => 'ru');
    setStoredToken(null);
    setStoredScopeId(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setStoredToken(null);
    setStoredScopeId(null);
  });

  const sentHeaders = (): Record<string, string> =>
    fetchMock.mock.calls[0][1].headers;

  it('always injects the x-locale header', async () => {
    await apiFetch('/api/projects');
    expect(sentHeaders()['x-locale']).toBe('ru');
  });

  it('injects Authorization and x-scope-id when a session is stored', async () => {
    setStoredToken('tok');
    setStoredScopeId('scope2');
    await apiFetch('/api/projects');
    expect(sentHeaders()['Authorization']).toBe('Bearer tok');
    expect(sentHeaders()['x-scope-id']).toBe('scope2');
  });

  it('skips auth headers for public requests', async () => {
    setStoredToken('tok');
    await apiFetch('/api/phone-bridge/sessions/t', { public: true });
    expect(sentHeaders()['Authorization']).toBeUndefined();
  });

  it('JSON-encodes object bodies with a content type', async () => {
    await apiFetch('/api/projects', { method: 'POST', body: { title: 'x' } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe('{"title":"x"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('funnels 401s into the unauthorized handler (but not for public calls)', async () => {
    const onUnauthorized = vi.fn();
    setApiUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await apiFetch('/api/projects');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await apiFetch('/api/auth/login', { public: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  describe('apiDownload filename', () => {
    const downloadWith = async (
      disposition: string | null,
    ): Promise<string> => {
      const headers = disposition
        ? { 'Content-Disposition': disposition }
        : undefined;
      fetchMock.mockResolvedValue(
        new Response('bytes', { status: 200, headers }),
      );
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn(() => 'blob:x'),
        revokeObjectURL: vi.fn(),
      });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      try {
        let name = '';
        click.mockImplementation(function (this: HTMLAnchorElement) {
          name = this.download;
        });
        await apiDownload('/api/uploads/att_1', {}, 'fallback.bin');
        return name;
      } finally {
        click.mockRestore();
      }
    };

    it('prefers the RFC 5987 filename* over the quoted fallback', async () => {
      expect(
        await downloadWith(
          `inline; filename="_.png"; filename*=UTF-8''%D1%84%D0%BE%D1%82%D0%BE.png`,
        ),
      ).toBe('фото.png');
    });

    it('uses the quoted filename when no filename* is present', async () => {
      expect(await downloadWith('inline; filename="board.stl"')).toBe(
        'board.stl',
      );
    });

    it('falls back to the caller-supplied name without a header', async () => {
      expect(await downloadWith(null)).toBe('fallback.bin');
    });
  });

  describe('apiJson with an empty successful body (#291)', () => {
    it('resolves to undefined on a body-less 200 instead of a parse error', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 200 }));
      await expect(
        apiJson('/api/projects/groups/reorder'),
      ).resolves.toBeUndefined();
    });

    it('resolves to undefined on a 204 No Content', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await expect(
        apiJson('/api/projects/groups/reorder'),
      ).resolves.toBeUndefined();
    });

    it('still parses a present body', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      await expect(apiJson('/api/projects')).resolves.toEqual({ ok: true });
    });

    it('tolerates test doubles that expose only json()', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'p1' }),
      });
      await expect(apiJson('/api/projects')).resolves.toEqual({ id: 'p1' });
    });
  });

  it('apiJson throws a typed ApiError carrying the backend message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), { status: 403 }),
    );
    await expect(apiJson('/api/projects')).rejects.toMatchObject({
      status: 403,
      message: 'nope',
    });
    await expect(apiJson('/api/projects')).rejects.toBeInstanceOf(ApiError);
  });
});
