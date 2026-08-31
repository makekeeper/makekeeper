import { NotifyService } from './notify.service';
import type {
  CapabilityRegistryService,
  PrismaService,
  RealtimeService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { NotifyDeliveryService } from './delivery.service';
import type {
  NotificationTypeDeclaration,
  ScopeDirectoryCapability,
} from '@makekeeper/plugin-contract';

// A notification row as the fake store keeps it — only the fields the service
// reads back.
interface StoredRow {
  id: string;
  scopeId: string | null;
  dedupKey: string | null;
  readAt: Date | null;
  occurrences: number;
  importance: string;
}

const DECLARATION: NotificationTypeDeclaration = {
  type: 'settings.update-available',
  labelKey: 'settings.notifications.updateAvailable.label',
  defaultImportance: 'normal',
};

function buildService(options?: {
  directory?: ScopeDirectoryCapability;
  configEnabled?: boolean;
}): { service: NotifyService; rows: StoredRow[]; emitted: string[] } {
  const rows: StoredRow[] = [];
  const emitted: string[] = [];

  const prisma = {
    notificationTypeConfig: {
      findFirst: async () =>
        options?.configEnabled === false
          ? { type: DECLARATION.type, importance: 'normal', enabled: false }
          : null,
      create: async () => undefined,
    },
    notification: {
      findFirst: async ({
        where,
      }: {
        where: { scopeId: string | null; dedupKey: string; readAt: null };
      }) =>
        rows.find(
          (row) =>
            row.scopeId === where.scopeId &&
            row.dedupKey === where.dedupKey &&
            row.readAt === null,
        ) ?? null,
      create: async ({
        data,
      }: {
        data: { id: string; scopeId: string | null; dedupKey: string | null };
      }) => {
        rows.push({
          id: data.id,
          scopeId: data.scopeId,
          dedupKey: data.dedupKey,
          readAt: null,
          occurrences: 1,
          importance: 'normal',
        });
      },
      update: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((entry) => entry.id === where.id);
        if (row) row.occurrences += 1;
      },
      groupBy: async () => [],
    },
  } as unknown as PrismaService;

  const context = {
    get: () => ({ scopeId: 'poster' }),
    // The real one retargets the access policy; here it only has to prove the
    // service asked for the recipient's scope rather than its own.
    runWithScope: async <T>(_scopeId: string, fn: () => Promise<T>) => fn(),
  } as unknown as RequestContextService;

  const realtime = {
    emitToRoom: (room: string) => emitted.push(room),
  } as unknown as RealtimeService;

  const capabilities = {
    getCapability: () => options?.directory ?? null,
  } as unknown as CapabilityRegistryService;

  // Channel delivery is queued, never awaited by the poster: the inbox row is
  // the delivery that always works, and a channel that is slow must not hold
  // the emitter's flow (#311).
  const delivery = {
    enqueue: async () => undefined,
  } as unknown as NotifyDeliveryService;

  const service = new NotifyService(
    prisma,
    context,
    realtime,
    capabilities,
    delivery,
  );
  service.declareTypes('settings', [DECLARATION]);
  return { service, rows, emitted };
}

describe('NotifyService.post', () => {
  it('refuses a type nobody declared', async () => {
    const { service, rows } = buildService();
    await service.post({
      type: 'settings.never-declared',
      target: { kind: 'user', userId: 'ann' },
      titleKey: 'x',
    });
    expect(rows).toHaveLength(0);
  });

  it('stores one row for the single reader when no overlay answers', async () => {
    const { service, rows, emitted } = buildService();
    await service.post({
      type: DECLARATION.type,
      target: { kind: 'audience', audience: 'admins' },
      titleKey: 'x',
    });
    expect(rows).toEqual([expect.objectContaining({ scopeId: null })]);
    expect(emitted).toEqual(['notify:solo']);
  });

  it('fans an audience out to one row per recipient', async () => {
    const directory: ScopeDirectoryCapability = {
      scopeExists: async () => true,
      displayNames: async () => ({}),
      audienceUserIds: async () => ['ann', 'bo'],
    };
    const { service, rows } = buildService({ directory });
    await service.post({
      type: DECLARATION.type,
      target: { kind: 'audience', audience: 'admins' },
      titleKey: 'x',
    });
    expect(rows.map((row) => row.scopeId)).toEqual(['ann', 'bo']);
  });

  it('folds a repeat into the unread row instead of stacking', async () => {
    const { service, rows } = buildService();
    const input = {
      type: DECLARATION.type,
      target: { kind: 'audience' as const, audience: 'admins' as const },
      titleKey: 'x',
      dedupKey: 'settings.update:0.14.0',
    };
    await service.post(input);
    await service.post(input);
    await service.post(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toBe(3);
  });

  it('starts a new row once the previous one has been read', async () => {
    const { service, rows } = buildService();
    const input = {
      type: DECLARATION.type,
      target: { kind: 'audience' as const, audience: 'admins' as const },
      titleKey: 'x',
      dedupKey: 'settings.update:0.14.0',
    };
    await service.post(input);
    // Read is finished business: the same fact happening again deserves to be
    // noticed again.
    const first = rows[0];
    if (first) first.readAt = new Date();
    await service.post(input);
    expect(rows).toHaveLength(2);
  });

  it('says nothing at all while the type is switched off', async () => {
    const { service, rows } = buildService({ configEnabled: false });
    await service.post({
      type: DECLARATION.type,
      target: { kind: 'audience', audience: 'admins' },
      titleKey: 'x',
    });
    expect(rows).toHaveLength(0);
  });
});
