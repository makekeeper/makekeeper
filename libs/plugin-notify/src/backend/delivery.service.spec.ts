import { NotifyDeliveryService } from './delivery.service';
import type {
  AppConfigService,
  CapabilityRegistryService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { NotifyService } from './notify.service';
import type {
  NotifyChannelCapability,
  RenderedNotification,
} from '@makekeeper/plugin-contract';

// A delivery row, with only the fields the service reads and writes.
interface StoredDelivery {
  id: string;
  notificationId: string;
  channelId: string;
  attempts: number;
  deliveredAt: Date | null;
  deadAt: Date | null;
  nextAttemptAt: Date | null;
  lastError: string | null;
}

const NOW = new Date('2026-08-31T09:00:00.000Z');

function buildService(): {
  service: NotifyDeliveryService;
  deliveries: StoredDelivery[];
  sent: RenderedNotification[];
} {
  const deliveries: StoredDelivery[] = [
    {
      id: 'del-1',
      notificationId: 'ntf-1',
      channelId: 'web-push',
      attempts: 0,
      deliveredAt: null,
      deadAt: null,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: null,
    },
  ];
  const sent: RenderedNotification[] = [];

  // The store's `updateMany` is what the claim rests on, so the fake honours the
  // same contract Prisma does: it matches on every field in `where` — including
  // `nextAttemptAt`, which is the one that moves — and reports how many rows it
  // actually changed.
  const matches = (
    row: StoredDelivery,
    where: Record<string, unknown>,
  ): boolean =>
    Object.entries(where).every(([key, value]) => {
      const current = row[key as keyof StoredDelivery];
      if (value instanceof Date) {
        return current instanceof Date && current.getTime() === value.getTime();
      }
      return current === value;
    });

  const prisma = {
    notificationDelivery: {
      // COPIES, as Prisma hands out: a fake that returns its own objects lets
      // one sweep's write appear inside another sweep's already-read row, and
      // the compare-and-set under test would pass for the wrong reason.
      findMany: async ({
        where,
      }: {
        where: { nextAttemptAt: { lte: Date } };
      }) =>
        deliveries
          .filter(
            (row) =>
              row.deliveredAt === null &&
              row.deadAt === null &&
              row.nextAttemptAt !== null &&
              row.nextAttemptAt.getTime() <= where.nextAttemptAt.lte.getTime(),
          )
          .map((row) => ({ ...row })),
      findFirst: async ({ where }: { where: { id: string } }) => {
        const row = deliveries.find((entry) => entry.id === where.id);
        return row ? { ...row } : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<StoredDelivery>;
      }) => {
        const hit = deliveries.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const index = deliveries.findIndex((row) => row.id === where.id);
        if (index >= 0) deliveries.splice(index, 1);
      },
    },
    notification: {
      findFirst: async () => ({
        id: 'ntf-1',
        scopeId: null,
        titleKey: 'notify.test.title',
        bodyKey: null,
        paramsJson: null,
        actionsJson: null,
        ref: null,
        importance: 'normal',
      }),
    },
    notifyPreference: { findFirst: async () => null },
    notificationActionToken: { create: async () => undefined },
  } as unknown as PrismaService;

  const channel: NotifyChannelCapability = {
    channelId: 'web-push',
    labelKey: 'notify.channels.webPush',
    isLinked: async () => true,
    deliver: async (message: RenderedNotification) => {
      sent.push(message);
    },
  };

  const capabilities = {
    getCapabilities: () => [{ pluginId: 'notify', impl: channel }],
  } as unknown as CapabilityRegistryService;

  const context = {
    runWithoutScope: async <T>(_reason: string, fn: () => Promise<T>) => fn(),
  } as unknown as RequestContextService;

  const i18n = { t: (key: string) => key } as unknown as PluginI18nService;
  const config = { publicBaseUrl: '' } as unknown as AppConfigService;
  const notify = {} as unknown as NotifyService;

  const service = new NotifyDeliveryService(
    prisma,
    capabilities,
    context,
    i18n,
    config,
    notify,
  );
  return { service, deliveries, sent };
}

describe('NotifyDeliveryService.drain', () => {
  it('sends a due delivery once', async () => {
    const { service, sent, deliveries } = buildService();
    await service.drain(NOW);
    expect(sent).toHaveLength(1);
    expect(deliveries[0].deliveredAt).not.toBeNull();
  });

  // The job guards one process against itself; two processes — a redeploy
  // overlapping its predecessor, a second replica, a stray dev instance — are
  // guarded by nothing but this, and the cost of being wrong is a person told
  // the same thing twice.
  it('sends it once when two sweeps see it at the same moment', async () => {
    const { service, sent } = buildService();
    await Promise.all([service.drain(NOW), service.drain(NOW)]);
    expect(sent).toHaveLength(1);
  });

  it('leaves a delivery it did not claim alone', async () => {
    const { service, deliveries, sent } = buildService();
    // Somebody else moved the row between the sweep's read and its claim.
    const stolen = { ...deliveries[0] };
    deliveries[0].nextAttemptAt = new Date(NOW.getTime() + 60_000);
    await service['attempt'](stolen, NOW);
    expect(sent).toHaveLength(0);
  });

  // A lease, not an "in progress" flag: the process holding it may never come
  // back, and the row has to become due again on its own.
  it('makes an abandoned delivery due again once the lease runs out', async () => {
    const { service, deliveries, sent } = buildService();
    // Claimed and then abandoned: the row still holds the lease this sweep set.
    await service['claim'](deliveries[0], NOW);
    const leased = deliveries[0].nextAttemptAt;
    expect(leased).not.toBeNull();
    expect(leased!.getTime()).toBeGreaterThan(NOW.getTime());

    await service.drain(NOW);
    expect(sent).toHaveLength(0);

    await service.drain(new Date(leased!.getTime() + 1000));
    expect(sent).toHaveLength(1);
  });
});
