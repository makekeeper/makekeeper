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
// redacted on read, and the hook response body must never be stored — and is
// only ever read for Coolify's generic deploy endpoint (#373).

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

    it('round-trips the unconfirmed outcome and drops an unknown one', async () => {
      service = makeService(row({ hookOutcome: 'unconfirmed' }));
      await expect(service.getState()).resolves.toMatchObject({
        lastOutcome: 'unconfirmed',
      });
      service = makeService(row({ hookOutcome: 'exploded' }));
      await expect(service.getState()).resolves.toMatchObject({
        lastOutcome: 'never',
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
          deployHookUrl: `${CIPHER_PREFIX}https://coolify.example.com/api/v1/services/abc/restart?latest=true`,
          deployHookToken: `${CIPHER_PREFIX}tok`,
          deployHookMethod: 'POST',
        }),
      );
      const text = vi.fn();
      const fetchFn = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, text });
      fetchMock(fetchFn);

      const result = await service.trigger();

      expect(fetchFn).toHaveBeenCalledWith(
        'https://coolify.example.com/api/v1/services/abc/restart?latest=true',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer tok' },
        }),
      );
      // The service restart endpoint is strict (404/403 on a bad uuid or
      // permission), so its status is the whole answer — no body is read.
      expect(text).not.toHaveBeenCalled();
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

    it('judges a non-Coolify hook by its status alone', async () => {
      const text = vi.fn();
      service = makeService(
        row({
          deployHookUrl: `${CIPHER_PREFIX}https://dokploy.example.com/api/deploy/s3cr3t`,
        }),
      );
      fetchMock(vi.fn().mockResolvedValue({ ok: true, status: 200, text }));

      const result = await service.trigger();

      expect(result.ok).toBe(true);
      expect(text).not.toHaveBeenCalled();
    });

    // #373: Coolify's generic /api/v1/deploy replies 200 for a request that
    // queued nothing, so for that endpoint a 2xx must report a deployment id.
    describe("Coolify's generic /api/v1/deploy", () => {
      const COOLIFY_DEPLOY =
        'https://coolify.example.com/api/v1/deploy?uuid=abc';

      const fire = async (
        reply: Partial<{ ok: boolean; status: number; body: string }>,
        url = COOLIFY_DEPLOY,
      ): Promise<{ ok: boolean; text: Mock }> => {
        service = makeService(
          row({
            deployHookUrl: `${CIPHER_PREFIX}${url}`,
            deployHookToken: `${CIPHER_PREFIX}tok`,
          }),
        );
        const text = vi.fn().mockResolvedValue(reply.body ?? '');
        fetchMock(
          vi.fn().mockResolvedValue({
            ok: reply.ok ?? true,
            status: reply.status ?? 200,
            text,
          }),
        );
        const result = await service.trigger();
        return { ok: result.ok, text };
      };

      const recorded = (outcome: string, status: number | null): void => {
        expect(upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              hookOutcome: outcome,
              hookStatusCode: status,
            }),
          }),
        );
      };

      it('reports ok when an application deployment was queued', async () => {
        const { ok } = await fire({
          body: JSON.stringify({
            deployments: [
              {
                message: 'Application x deployment queued.',
                resource_uuid: 'abc',
                deployment_uuid: 'dep-1',
              },
            ],
          }),
        });
        expect(ok).toBe(true);
        recorded('ok', 200);
      });

      it('reports ok when a tag deploy lists a queued deployment', async () => {
        const { ok } = await fire(
          {
            body: JSON.stringify({
              message: ['Application x deployment queued.'],
              details: [{ resource_uuid: 'abc', deployment_uuid: 'dep-1' }],
            }),
          },
          'https://coolify.example.com/api/v1/deploy?tag=makekeeper',
        );
        expect(ok).toBe(true);
        recorded('ok', 200);
      });

      // A compose service — how MakeKeeper is installed on Coolify — is started
      // without a deployment id; so is a refused resource. The body cannot tell
      // the two apart reliably, so neither is reported as a success.
      it.each([
        [
          'a service start',
          { message: 'Service x started. It could take a while, be patient.' },
        ],
        ['a refusal', { message: 'Unauthorized to deploy this service.' }],
        [
          'a skipped deployment',
          { message: 'Deployment skipped', deployment_uuid: '' },
        ],
      ])(
        'reports unconfirmed for %s answered with 200',
        async (_label, entry) => {
          const { ok } = await fire({
            body: JSON.stringify({
              deployments: [{ resource_uuid: 'abc', ...entry }],
            }),
          });
          expect(ok).toBe(false);
          recorded('unconfirmed', 200);
        },
      );

      it.each([
        ['a non-JSON body', 'OK'],
        ['an empty body', ''],
        ['an unexpected shape', JSON.stringify(['dep-1'])],
        [
          'an oversized body',
          JSON.stringify({
            deployments: [{ deployment_uuid: 'dep-1' }],
            pad: 'x'.repeat(70_000),
          }),
        ],
      ])('reports unconfirmed for %s', async (_label, body) => {
        const { ok } = await fire({ body });
        expect(ok).toBe(false);
        recorded('unconfirmed', 200);
      });

      it('reports unconfirmed when the body cannot be read', async () => {
        service = makeService(
          row({ deployHookUrl: `${CIPHER_PREFIX}${COOLIFY_DEPLOY}` }),
        );
        fetchMock(
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: vi.fn().mockRejectedValue(new Error('aborted')),
          }),
        );
        const result = await service.trigger();
        expect(result.ok).toBe(false);
        recorded('unconfirmed', 200);
      });

      // GET has answered 405 since Coolify v4.2.0 — what a hook saved from the
      // old recipe gets; 404 is an unknown uuid; 403 a missing permission.
      it.each([405, 404, 403, 401])(
        'records HTTP %i as failed without reading the body',
        async (status) => {
          const { ok, text } = await fire({ ok: false, status });
          expect(ok).toBe(false);
          expect(text).not.toHaveBeenCalled();
          recorded('failed', status);
        },
      );

      it('never stores or returns the body it inspected', async () => {
        const secret = 'echoed-s3cr3t';
        await fire({
          body: JSON.stringify({
            deployments: [{ message: secret, deployment_uuid: 'dep-1' }],
          }),
        });
        expect(JSON.stringify(upsert.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(await service.getState())).not.toContain(secret);
      });
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
