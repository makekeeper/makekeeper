import { ExternalDiscoveryService } from './external-discovery.service';
import type {
  PluginRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';

// Opening the pairing window must not start a wait (#177).
//
// A container that announced while the window was shut had to come back on its
// own — up to twenty seconds of an admin staring at the empty list they just
// opened for exactly this. The core already holds everything it needs; the
// window is an admin gesture, not a source of facts.

const manifest = {
  contract: { major: 1, minor: 0 },
  pluginId: 'demo',
  version: '1.0.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Box',
  scopeModel: 'instance',
  permissions: [],
  i18n: { en: { name: 'Demo', description: 'Demo' } },
  screens: ['home'],
  nav: [{ screen: 'home', titleKey: 'name', icon: 'Box' }],
};

const setup = (installed: Record<string, unknown> | null = null) => {
  const rows: Array<Record<string, unknown>> = [];
  const plugins: Record<string, unknown>[] = installed ? [installed] : [];
  const prisma = {
    externalCandidate: {
      count: async () => rows.length,
      findFirst: async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        const wantsPaired =
          typeof where['pairedAt'] === 'object' && where['pairedAt'] !== null;
        return (
          rows.find((row) => {
            if (where['pluginId'] && row['pluginId'] !== where['pluginId']) {
              return false;
            }
            if (
              where['announceKeyHash'] &&
              row['announceKeyHash'] !== where['announceKeyHash']
            ) {
              return false;
            }
            if (wantsPaired && !row['pairedAt']) return false;
            if (where['ignoredAt'] && !row['ignoredAt']) return false;
            return true;
          }) ?? null
        );
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row['id'] === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const at = rows.findIndex((row) => row['id'] === where.id);
        if (at >= 0) rows.splice(at, 1);
        return {};
      },
      findMany: async () => rows,
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        // Enough of Prisma's shape for what this service asks of it: an id, a
        // key hash, and "unpaired only".
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const row = rows[i]!;
          if (where['pluginId'] && row['pluginId'] !== where['pluginId'])
            continue;
          if (
            where['announceKeyHash'] &&
            row['announceKeyHash'] !== where['announceKeyHash']
          ) {
            continue;
          }
          if (where['pairedAt'] === null && row['pairedAt']) continue;
          rows.splice(i, 1);
        }
        return { count: 0 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        rows.push(data);
        return data;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((item) => item['id'] === where.id);
        if (row) Object.assign(row, data);
        return row ?? {};
      },
    },
    externalPlugin: {
      findMany: async () => plugins,
      findUnique: async () => plugins[0] ?? null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(plugins[0] ?? {}, data);
        return plugins[0];
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        plugins.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;
  const registry = { getPlugins: () => [] } as unknown as PluginRegistryService;
  // The secret box and the token service are only reached on PAIRING, which
  // this file does not exercise.
  const service = new ExternalDiscoveryService(
    prisma,
    registry,
    {
      encrypt: (value: string) => `enc:${value}`,
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    } as never,
    { newPluginSecret: () => 'fresh-secret' } as never,
  );
  return { rows, plugins, service };
};

const knock = {
  manifest,
  baseUrl: 'http://localhost:4400',
  announceKey: 'key',
  pairingCode: '1234',
  sourceIp: null,
};

describe('pairing window', () => {
  it('refuses an announce while it is shut, and counts it', async () => {
    const { service, rows } = setup();
    expect(await service.announce(knock)).toEqual({ error: 'pairing-closed' });
    expect(rows).toHaveLength(0);
    expect(service.pairingStatus().knocking).toBe(1);
  });

  it('turns whoever knocked into a candidate the moment it opens', async () => {
    const { service, rows } = setup();
    await service.announce(knock);
    await service.openPairing();
    // No second announce: the container said everything the first time.
    expect(rows).toHaveLength(1);
    expect(rows[0]!['pluginId']).toBe('demo');
    // And the doorbell is cleared — the count has done its job.
    expect(service.pairingStatus().knocking).toBe(0);
  });

  it('holds one entry per container, however often it retries', async () => {
    const { service, rows } = setup();
    for (let i = 0; i < 5; i += 1) await service.announce(knock);
    await service.openPairing();
    expect(rows).toHaveLength(1);
  });
});

describe('pairing an id that is already installed', () => {
  it('hands the installation to the container that proved the code', async () => {
    // A container comes back with no state — its volume was dropped, its host
    // moved — and the core still holds the installation. Refusing left the
    // admin with a plugin nothing could answer for, and uninstalling would
    // have taken the grants, the consent and the plugin's data with it.
    const { service, rows, plugins } = setup({
      pluginId: 'demo',
      baseUrl: 'http://old:4400',
      secretEnc: 'enc:old-secret',
      grantsJson: '["inventory:read"]',
      status: 'active',
      assistantEnabled: true,
    });
    await service.openPairing();
    await service.announce({ ...knock, baseUrl: 'http://new:4700' });
    const candidate = rows[0]!;
    // The candidate is created with a hashed code; pair with the clear one.
    const result = await service.pair(String(candidate['id']), '1234');
    expect(result).toEqual({ ok: true });

    const row = plugins[0]!;
    expect(row['baseUrl']).toBe('http://new:4700');
    expect(row['secretEnc']).toBe('enc:fresh-secret');
    // Everything the admin decided survives.
    expect(row['grantsJson']).toBe('["inventory:read"]');
    expect(row['status']).toBe('active');
    expect(row['assistantEnabled']).toBe(true);
  });

  it('still refuses a wrong code', async () => {
    const { service, rows } = setup({ pluginId: 'demo', grantsJson: '[]' });
    await service.openPairing();
    await service.announce(knock);
    expect(await service.pair(String(rows[0]!['id']), '9999')).toEqual({
      error: 'bad-code',
    });
  });
});

describe('a pairing the container has not collected yet', () => {
  // The sequence that lost one: the container's announce is refused (window
  // shut) and it sleeps twenty seconds without polling; the admin opens the
  // window, which turns that refused announce into a candidate, and pairs it;
  // the container wakes, announces again — and that fresher card used to
  // shadow the paired one, so the secret behind it was never collected and the
  // container announced forever with the installation already made.
  const paired = async () => {
    const { service, rows } = setup();
    await service.announce(knock); // refused: window shut
    await service.openPairing(); // materialises it
    await service.pair(String(rows[0]!['id']), '1234');
    return { service, rows };
  };

  it('is not shadowed by the container announcing again', async () => {
    const { service, rows } = await paired();
    expect(await service.announce(knock)).toEqual({ status: 'waiting' });
    // Still exactly one card, and it is the paired one.
    expect(rows).toHaveLength(1);
    expect(rows[0]!['pairedAt']).toBeTruthy();
  });

  it('is handed over on the next claim, once', async () => {
    const { service, rows } = await paired();
    const first = await service.claim('demo', 'key');
    expect(first).toMatchObject({ status: 'paired' });
    expect(rows).toHaveLength(0);
    // One-shot: a second claim finds nothing.
    expect(await service.claim('demo', 'key')).toEqual({ error: 'unknown' });
  });
});
