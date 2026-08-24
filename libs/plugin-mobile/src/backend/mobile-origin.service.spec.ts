import { MobileOriginService } from './mobile-origin.service';
import type { MobileSettingsService } from './mobile-settings.service';
import type {
  AppConfigService,
  RequestHeadersLike,
} from '@makekeeper/backend-core';

// One resolver answers "where should a phone be sent". Before it existed the
// pairing QR and the installability verdict each derived that separately and
// could disagree the moment a custom origin was configured — so the precedence
// itself is the thing worth pinning.

const request = { headers: {} } as unknown as RequestHeadersLike;

function harness(options: {
  envOrigin?: string | null;
  customOrigin?: string | null;
  publicBaseUrl?: string | null;
  secureOrigin?: string | null;
  tunnel?: {
    usable?: boolean;
    current?: string | null;
    ensured?: string | null;
    freshlyStarted?: boolean;
  } | null;
}) {
  const ensure = jest.fn().mockResolvedValue({
    url: options.tunnel?.ensured ?? null,
    freshlyStarted: options.tunnel?.freshlyStarted ?? false,
  });

  const config = {
    getMobileOriginOverride: () => options.envOrigin ?? null,
    getPublicBaseUrlOverride: () => options.publicBaseUrl ?? null,
    pickSecurePublicOrigin: () => options.secureOrigin ?? null,
  } as unknown as AppConfigService;

  const settings = {
    getStored: () =>
      Promise.resolve({ customOrigin: options.customOrigin ?? null }),
    tunnel: () =>
      options.tunnel
        ? {
            tunnelUsable: () => Promise.resolve(options.tunnel?.usable ?? true),
            currentTunnelUrl: () =>
              Promise.resolve(options.tunnel?.current ?? null),
            ensureTunnel: ensure,
          }
        : null,
  } as unknown as MobileSettingsService;

  return { service: new MobileOriginService(config, settings), ensure };
}

describe('MobileOriginService.resolveForPhone', () => {
  it('lets the environment win over everything', async () => {
    const { service } = harness({
      envOrigin: 'https://env.example.com',
      customOrigin: 'https://ui.example.com',
      publicBaseUrl: 'https://public.example.com',
    });
    await expect(service.resolveForPhone(request)).resolves.toMatchObject({
      url: 'https://env.example.com',
      freshlyStarted: false,
    });
  });

  it('uses the address configured in the UI next — the everyday case', async () => {
    const { service } = harness({
      customOrigin: 'https://ui.example.com',
      publicBaseUrl: 'https://public.example.com',
    });
    await expect(service.resolveForPhone(request)).resolves.toMatchObject({
      url: 'https://ui.example.com',
    });
  });

  it('falls back to how the instance as a whole is published', async () => {
    const { service } = harness({
      publicBaseUrl: 'https://public.example.com',
    });
    await expect(service.resolveForPhone(request)).resolves.toMatchObject({
      url: 'https://public.example.com',
    });
  });

  it('then to the secure origin this request arrived on', async () => {
    const { service } = harness({
      secureOrigin: 'https://arrived.example.com',
    });
    await expect(service.resolveForPhone(request)).resolves.toMatchObject({
      url: 'https://arrived.example.com',
    });
  });

  // A tunnel that has just come up is not reachable for a few seconds, and the
  // caller has to know that before it paints a QR someone will scan.
  it('brings a tunnel up as the last resort, and says it just started', async () => {
    const { service, ensure } = harness({
      tunnel: {
        ensured: 'https://brave-fox.trycloudflare.com',
        freshlyStarted: true,
      },
    });
    await expect(service.resolveForPhone(request)).resolves.toEqual({
      url: 'https://brave-fox.trycloudflare.com',
      freshlyStarted: true,
    });
    expect(ensure).toHaveBeenCalled();
  });

  it('reports no warm-up for a tunnel that was already running', async () => {
    const { service } = harness({
      tunnel: {
        ensured: 'https://brave-fox.trycloudflare.com',
        freshlyStarted: false,
      },
    });
    await expect(service.resolveForPhone(request)).resolves.toMatchObject({
      freshlyStarted: false,
    });
  });

  it('never starts a tunnel when only asked what exists', async () => {
    const { service, ensure } = harness({
      tunnel: { current: null, ensured: 'https://started.trycloudflare.com' },
    });
    await service.resolveForPhone(request, undefined, false);
    expect(ensure).not.toHaveBeenCalled();
  });

  // A tunnel name that arrived as "the secure origin of this request" is the
  // phone talking THROUGH the tunnel; it must not shadow a real address.
  it('does not treat an ephemeral request origin as a permanent one', async () => {
    const { service } = harness({
      secureOrigin: 'https://brave-fox.trycloudflare.com',
      tunnel: { ensured: 'https://fresh-fox.trycloudflare.com' },
    });
    await expect(service.resolveForPhone(request)).resolves.toMatchObject({
      url: 'https://fresh-fox.trycloudflare.com',
    });
  });
});

describe('MobileOriginService.canPair', () => {
  it('is true with a real address', async () => {
    const { service } = harness({ customOrigin: 'https://ui.example.com' });
    await expect(service.canPair(request)).resolves.toBe(true);
  });

  it('is true with no address but a usable tunnel', async () => {
    const { service } = harness({ tunnel: { usable: true } });
    await expect(service.canPair(request)).resolves.toBe(true);
  });

  it('is false with nothing a phone could reach', async () => {
    const { service } = harness({ tunnel: null });
    await expect(service.canPair(request)).resolves.toBe(false);
  });

  // A QR pointing at localhost is a QR pointing nowhere.
  it('is false when the only address is loopback', async () => {
    const { service } = harness({
      secureOrigin: 'http://localhost:4200',
      tunnel: null,
    });
    await expect(service.canPair(request)).resolves.toBe(false);
  });
});
