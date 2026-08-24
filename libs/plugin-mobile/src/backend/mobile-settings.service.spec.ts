import { MobileSettingsService } from './mobile-settings.service';
import type {
  AppConfigService,
  CapabilityRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';

// Where the mobile surface is published: the one thing this singleton still
// decides since the install toggle went away (#210).

interface Row {
  customOrigin: string | null;
}

function harness(options: {
  stored?: Partial<Row>;
  envMobileOrigin?: string | null;
  publicBaseUrl?: string | null;
  tunnel?: { usable: boolean } | null;
}) {
  const row: Row = { customOrigin: options.stored?.customOrigin ?? null };

  const prisma = {
    mobileSettings: {
      findUnique: () => Promise.resolve({ id: 'default', ...row }),
      upsert: ({ update }: { update: Row }) => {
        Object.assign(row, update);
        return Promise.resolve({ id: 'default', ...row });
      },
    },
  } as unknown as PrismaService;

  const config = {
    getMobileOriginOverride: () => options.envMobileOrigin ?? null,
    getPublicBaseUrlOverride: () => options.publicBaseUrl ?? null,
    getSessionCookieDomain: () => null,
  } as unknown as AppConfigService;

  const capabilities = {
    getCapability: () =>
      options.tunnel === null || options.tunnel === undefined
        ? null
        : {
            tunnelUsable: () => Promise.resolve(options.tunnel!.usable),
            currentTunnelUrl: () => Promise.resolve(null),
            ensureTunnel: () => Promise.resolve(null),
          },
  } as unknown as CapabilityRegistryService;

  return {
    service: new MobileSettingsService(prisma, config, capabilities),
    row,
  };
}

describe('MobileSettingsService — the published address', () => {
  it('reports the env override and normalizes a stored origin', async () => {
    const { service } = harness({
      envMobileOrigin: 'https://phone.example.com',
      tunnel: { usable: true },
    });
    await service.update({ customOrigin: 'https://typed.example.com/' });
    const settings = await service.getPublic();
    expect(settings.originEnvOverride).toBe('https://phone.example.com');
    // The trailing slash is what people actually type.
    expect(settings.customOrigin).toBe('https://typed.example.com');
  });

  it('clears the origin on an empty string', async () => {
    const { service } = harness({
      stored: { customOrigin: 'https://old.example.com' },
      tunnel: { usable: true },
    });
    await service.update({ customOrigin: '' });
    await expect(service.getPublic()).resolves.toMatchObject({
      customOrigin: null,
    });
  });
});
