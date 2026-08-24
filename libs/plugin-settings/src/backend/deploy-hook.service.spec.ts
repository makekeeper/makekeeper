import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { BadRequestException, Logger } from '@nestjs/common';
import {
  PluginI18nService,
  PrismaService,
  SecretBoxService,
} from '@makekeeper/backend-core';
import { DeployHookService } from './deploy-hook.service';

// The behaviours worth pinning are the security ones: the URL is a secret (it
// can carry a deploy token in its path), so it must be encrypted at rest and
// redacted on read, and the hook response body must never be touched.

type Row = {
  deployHookUrl: string | null;
  deployHookToken: string | null;
  deployHookMethod: string;
  hookTriggeredAt: Date | null;
  hookOutcome: string;
  hookStatusCode: number | null;
};

const row = (patch: Partial<Row> = {}): Row => ({
  deployHookUrl: null,
  deployHookToken: null,
  deployHookMethod: 'POST',
  hookTriggeredAt: null,
  hookOutcome: 'never',
  hookStatusCode: null,
  ...patch,
});

// Reversible stand-in for the real secret box — keeps the assertions about
// "was it encrypted before it hit the DB" readable.
const CIPHER_PREFIX = 'enc:';
const secretBox = {
  encrypt: (plain: string) => `${CIPHER_PREFIX}${plain}`,
  decrypt: (payload: string) =>
    payload.startsWith(CIPHER_PREFIX)
      ? payload.slice(CIPHER_PREFIX.length)
      : null,
  isEncrypted: (value: string) => value.startsWith(CIPHER_PREFIX),
} as unknown as SecretBoxService;

// Resolves keys to themselves so a thrown i18n key is assertable verbatim.
const i18n = {
  t: (key: string) => key,
} as unknown as PluginI18nService;

describe('DeployHookService', () => {
  let findUnique: Mock;
  let upsert: Mock;
  let service: DeployHookService;

  const makeService = (stored: Row | null): DeployHookService => {
    findUnique = vi.fn().mockResolvedValue(stored);
    upsert = vi.fn().mockResolvedValue(stored ?? row());
    const prisma = {
      updateCheckSettings: { findUnique, upsert },
    } as unknown as PrismaService;
    return new DeployHookService(prisma, secretBox, i18n);
  };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = makeService(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('getState', () => {
    it('reports "not configured" when no row exists', async () => {
      await expect(service.getState()).resolves.toEqual({
        hasUrl: false,
        urlPreview: null,
        method: 'POST',
        hasToken: false,
        lastTriggeredAt: null,
        lastOutcome: 'never',
        lastStatusCode: null,
      });
    });

    it('redacts the hook path — it can itself be the deploy token', async () => {
      service = makeService(
        row({
          deployHookUrl: `${CIPHER_PREFIX}https://dokploy.example.com/api/deploy/s3cr3t-token`,
          deployHookToken: `${CIPHER_PREFIX}bearer-token`,
          deployHookMethod: 'GET',
        }),
      );
      const state = await service.getState();
      expect(state.urlPreview).toBe('https://dokploy.example.com/…');
      expect(JSON.stringify(state)).not.toContain('s3cr3t-token');
      expect(JSON.stringify(state)).not.toContain('bearer-token');
      expect(state).toMatchObject({
        hasUrl: true,
        hasToken: true,
        method: 'GET',
      });
    });

    it('degrades to "not configured" when the read fails', async () => {
      findUnique.mockRejectedValue(new Error('relation does not exist'));
      await expect(service.getState()).resolves.toMatchObject({
        hasUrl: false,
      });
    });

    it('falls back to POST for an unrecognised stored method', async () => {
      service = makeService(row({ deployHookMethod: 'PUT' }));
      await expect(service.getState()).resolves.toMatchObject({
        method: 'POST',
      });
    });
  });

  describe('updateSettings', () => {
    it('encrypts the URL and the token before they reach the DB', async () => {
      await service.updateSettings({
        url: 'https://manager.example.com/deploy/abc',
        token: 'tok',
      });
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            deployHookUrl: `${CIPHER_PREFIX}https://manager.example.com/deploy/abc`,
            deployHookToken: `${CIPHER_PREFIX}tok`,
          },
        }),
      );
    });

    it('leaves untouched fields out of the write, so a blank form keeps the secret', async () => {
      service = makeService(
        row({ deployHookUrl: `${CIPHER_PREFIX}https://manager.example.com/d` }),
      );
      await service.updateSettings({ method: 'GET' });
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { deployHookMethod: 'GET' } }),
      );
    });

    it('clears a secret when an empty string is sent', async () => {
      await service.updateSettings({ url: '', token: '  ' });
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { deployHookUrl: null, deployHookToken: null },
        }),
      );
    });

    // A hook that cannot fire must not report "saved": the admin would leave the
    // page believing one-click update works and only find out at trigger time.
    it('refuses a token with no URL to send it to', async () => {
      await expect(service.updateSettings({ token: 'tok' })).rejects.toThrow(
        BadRequestException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a method with no URL to send it to', async () => {
      await expect(service.updateSettings({ method: 'GET' })).rejects.toThrow(
        BadRequestException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    // The URL can itself carry the credential, so a token left behind after the
    // hook is removed is a live secret guarding nothing.
    it('drops the token when the URL is cleared', async () => {
      service = makeService(
        row({
          deployHookUrl: `${CIPHER_PREFIX}https://manager.example.com/d`,
          deployHookToken: `${CIPHER_PREFIX}tok`,
        }),
      );
      await service.updateSettings({ url: '' });
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { deployHookUrl: null, deployHookToken: null },
        }),
      );
    });

    // The settings form sends its method with every save, so the clear payload
    // arrives as { url: '', method } — refusing it over the method made an
    // emptied URL field impossible to save (#270).
    it('ignores a method riding along with a URL clear', async () => {
      service = makeService(
        row({
          deployHookUrl: `${CIPHER_PREFIX}https://manager.example.com/d`,
          deployHookToken: `${CIPHER_PREFIX}tok`,
        }),
      );
      await service.updateSettings({ url: '', method: 'POST' });
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { deployHookUrl: null, deployHookToken: null },
        }),
      );
    });

    it.each(['not-a-url', 'file:///etc/passwd', 'ftp://host/deploy'])(
      'rejects %s as a hook URL',
      async (url) => {
        await expect(service.updateSettings({ url })).rejects.toThrow(
          BadRequestException,
        );
        expect(upsert).not.toHaveBeenCalled();
      },
    );
  });

  describe('trigger', () => {
    const fetchMock = (impl: Mock): void => {
      vi.stubGlobal('fetch', impl);
    };

    it('refuses to fire when no hook is configured', async () => {
      await expect(service.trigger()).rejects.toThrow(
        'settings.errors.deployHookNotConfigured',
      );
    });

    it('calls the configured URL with the stored method and bearer token', async () => {
      service = makeService(
        row({
          deployHookUrl: `${CIPHER_PREFIX}https://coolify.example.com/api/v1/deploy?uuid=abc`,
          deployHookToken: `${CIPHER_PREFIX}tok`,
          deployHookMethod: 'GET',
        }),
      );
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      fetchMock(fetchFn);

      const result = await service.trigger();

      expect(fetchFn).toHaveBeenCalledWith(
        'https://coolify.example.com/api/v1/deploy?uuid=abc',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer tok' },
        }),
      );
      expect(result.ok).toBe(true);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            hookOutcome: 'ok',
            hookStatusCode: 200,
          }),
        }),
      );
    });

    it('records a rejection instead of throwing, and never reads the body', async () => {
      const text = vi.fn();
      const json = vi.fn();
      service = makeService(
        row({ deployHookUrl: `${CIPHER_PREFIX}https://m.example.com/d` }),
      );
      fetchMock(
        vi.fn().mockResolvedValue({ ok: false, status: 401, text, json }),
      );

      const result = await service.trigger();

      expect(result.ok).toBe(false);
      expect(text).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            hookOutcome: 'failed',
            hookStatusCode: 401,
          }),
        }),
      );
    });

    it('records a transport failure with no status code', async () => {
      service = makeService(
        row({ deployHookUrl: `${CIPHER_PREFIX}https://m.example.com/d` }),
      );
      fetchMock(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const result = await service.trigger();

      expect(result.ok).toBe(false);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            hookOutcome: 'failed',
            hookStatusCode: null,
          }),
        }),
      );
    });

    it('sends no Authorization header when no token is stored', async () => {
      service = makeService(
        row({ deployHookUrl: `${CIPHER_PREFIX}https://m.example.com/d` }),
      );
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      fetchMock(fetchFn);

      await service.trigger();

      expect(fetchFn).toHaveBeenCalledWith(
        'https://m.example.com/d',
        expect.objectContaining({ method: 'POST', headers: {} }),
      );
    });
  });
});
