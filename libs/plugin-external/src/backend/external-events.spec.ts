import { ExternalEventsService } from './external-events.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalSettingsService } from './external-settings.service';
import { ExternalPermissionsService } from './external-permissions.service';
import type { AgentRegistryService } from '@makekeeper/backend-core';
import type { ExternalScopeRefService } from './external-scope-ref.service';
import type {
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { ExternalRegistryService } from './external-registry.service';
import type { ExternalSignerService } from './external-signer.service';
import type {
  ExternalPluginManifest,
  ExternalWebhookEvent,
} from '@makekeeper/plugin-contract';

// Typed like the real signer so `post.mock.calls[n][3]` is the payload, not
// an element of an empty tuple.
type PostFn = (
  baseUrl: string,
  secret: string,
  path: string,
  payload: unknown,
  timeoutMs: number,
) => Promise<{
  ok: boolean;
  status: number;
  body: unknown;
  errorCode?: string;
}>;

const makePost = (ok: boolean, errorCode?: string): jest.Mock =>
  jest.fn<ReturnType<PostFn>, Parameters<PostFn>>(async () => ({
    ok,
    status: ok ? 200 : 500,
    body: ok ? {} : null,
    errorCode,
  }));

// Fakes kept deliberately small: what matters here is the DELIVERY POLICY —
// who gets an event, what the payload may carry, and what happens to a
// delivery that fails.

const manifest = (events: string[]): ExternalPluginManifest => ({
  contract: { major: 1, minor: 0 },
  pluginId: 'demo',
  version: '1',
  nameKey: 'demo.name',
  icon: 'Blocks',
  scopeModel: 'instance',
  permissions: [],
  i18n: { en: { demo: { name: 'Demo' } } },
  screens: [],
  events,
});

interface Row {
  id: string;
  pluginId: string;
  eventId: string;
  type: string;
  eventScopeId: string | null;
  ref: string | null;
  changedJson: string | null;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  deadAt: Date | null;
  lastError: string | null;
}

const makeService = (opts: {
  subscribers: Array<{
    pluginId: string;
    events: string[];
    grants?: string[];
    scopeId?: string | null;
  }>;
  post: jest.Mock;
}) => {
  const rows: Row[] = [];
  const prisma = {
    externalEventDelivery: {
      // `data` carries what the service writes; the rest are column defaults
      // the real table would apply.
      createMany: jest.fn(async ({ data }: { data: Array<Partial<Row>> }) => {
        rows.push(
          ...data.map(
            (d) =>
              ({
                attempts: 0,
                deliveredAt: null,
                deadAt: null,
                lastError: null,
                ...d,
              }) as Row,
          ),
        );
      }),
      findMany: jest.fn(async () =>
        rows.filter(
          (r) =>
            r.deliveredAt === null &&
            r.deadAt === null &&
            r.nextAttemptAt !== null &&
            // Match the real query: a row rescheduled into the future is not
            // due, so an extra drain() must not double-deliver it.
            r.nextAttemptAt.getTime() <= Date.now(),
        ),
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Row>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
        },
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  } as unknown as PrismaService;

  const active = opts.subscribers.map((s) => ({
    pluginId: s.pluginId,
    baseUrl: 'http://plugin',
    manifest: { ...manifest(s.events), pluginId: s.pluginId },
    grants: s.grants ?? [],
    secret: 'secret',
    scopeId: s.scopeId ?? null,
    assistantEnabled: false,
  }));
  const registry = {
    listActive: async () => active,
    getActive: async (id: string) =>
      active.find((p) => p.pluginId === id) ?? null,
  } as unknown as ExternalRegistryService;

  const signer = { post: opts.post } as unknown as ExternalSignerService;
  const context = {
    runWithoutScope: <T>(_reason: string, fn: () => Promise<T>) => fn(),
  } as unknown as RequestContextService;

  const scopeRefs = {
    toRef: async (_pluginId: string, scopeId: string | null) =>
      scopeId ? `ref-${scopeId}` : null,
  } as unknown as ExternalScopeRefService;
  const service = new ExternalEventsService(
    prisma,
    registry,
    signer,
    new ExternalBreakerService(
      new ExternalSettingsService(
        {} as unknown as ConstructorParameters<
          typeof ExternalSettingsService
        >[0],
      ),
    ),
    context,
    scopeRefs,
    // The real thing, not a fake: the grant policy IS what several of these
    // tests exercise. Its agent-registry dependency feeds only the tool
    // surface, which no event path touches.
    new ExternalPermissionsService({} as unknown as AgentRegistryService),
  );
  // `publish` kicks off a drain fire-and-forget (production wants the event
  // out promptly, not the caller blocked). Tests must let that settle before
  // asserting, otherwise the guard flag makes their own drain() a no-op.
  // Generous tick count: every await inside deliver() (scope-ref translation,
  // the signed post, the row update) costs one, and a settle that undershoots
  // makes the test's own drain() a silent no-op.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 25; i++) await Promise.resolve();
  };

  return { service, rows, settle, active };
};

describe('ExternalEventsService', () => {
  it('fans an event out only to plugins subscribed to its type', async () => {
    const post = makePost(true);
    const { service, rows } = makeService({
      subscribers: [
        {
          pluginId: 'a',
          events: ['inventory.item.changed'],
          grants: ['inventory:read'],
        },
        {
          pluginId: 'b',
          events: ['logistics.order.received'],
          grants: ['logistics:read'],
        },
      ],
      post,
    });
    await service.publish({ type: 'inventory.item.changed', scopeId: 's1' });
    expect(rows.map((r) => r.pluginId)).toEqual(['a']);
  });

  it('hearing is reading: a subscription without the owner read grant hears nothing', async () => {
    const post = makePost(true);
    const { service, rows } = makeService({
      subscribers: [
        { pluginId: 'nosy', events: ['inventory.item.changed'] },
        {
          pluginId: 'reader',
          events: ['inventory.item.changed'],
          // Write implies read, same as on the tool surface.
          grants: ['inventory:write'],
        },
      ],
      post,
    });
    await service.publish({ type: 'inventory.item.changed', scopeId: 's1' });
    expect(rows.map((r) => r.pluginId)).toEqual(['reader']);
  });

  it('lifecycle core.* events have no owner and need no grant', async () => {
    const post = makePost(true);
    const { service, rows } = makeService({
      subscribers: [{ pluginId: 'a', events: ['core.scope-deleted'] }],
      post,
    });
    await service.publish({ type: 'core.scope-deleted', scopeId: 's1' });
    expect(rows).toHaveLength(1);
  });

  it('a per-scope plugin hears only its bound scope; scopeless events are instance-only', async () => {
    const post = makePost(true);
    const { service, rows } = makeService({
      subscribers: [
        {
          pluginId: 'mine',
          events: ['inventory.item.changed'],
          grants: ['inventory:read'],
          scopeId: 's1',
        },
        {
          pluginId: 'other',
          events: ['inventory.item.changed'],
          grants: ['inventory:read'],
          scopeId: 's2',
        },
        {
          pluginId: 'wide',
          events: ['inventory.item.changed'],
          grants: ['instance:inventory:read'],
          scopeId: null,
        },
      ],
      post,
    });
    await service.publish({ type: 'inventory.item.changed', scopeId: 's1' });
    expect(rows.map((r) => r.pluginId).sort()).toEqual(['mine', 'wide']);

    rows.length = 0;
    await service.publish({ type: 'inventory.item.changed' });
    expect(rows.map((r) => r.pluginId)).toEqual(['wide']);
  });

  it('a grant revoked while the row waited dead-letters it instead of delivering', async () => {
    const post = makePost(true);
    const { service, rows, settle, active } = makeService({
      subscribers: [
        {
          pluginId: 'a',
          events: ['inventory.item.changed'],
          grants: ['inventory:read'],
        },
      ],
      post,
    });
    await service.publish({ type: 'inventory.item.changed', scopeId: 's1' });
    // The admin revokes between fan-out and delivery.
    active[0].grants = [];
    await settle();
    await service.drain();
    expect(post).not.toHaveBeenCalled();
    expect(rows[0].deadAt).not.toBeNull();
    expect(rows[0].lastError).toBe('grant-revoked');
  });

  it('gives every subscriber the SAME eventId (idempotency key) on its own row', async () => {
    const post = makePost(true);
    const { service, rows } = makeService({
      subscribers: [
        { pluginId: 'a', events: ['x'] },
        { pluginId: 'b', events: ['x'] },
      ],
      post,
    });
    await service.publish({ type: 'x' });
    expect(rows).toHaveLength(2);
    expect(rows[0].eventId).toBe(rows[1].eventId);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('never sends record data — id, type, version, scope, ref and changed NAMES only', async () => {
    const post = makePost(true);
    const { service, settle } = makeService({
      subscribers: [{ pluginId: 'a', events: ['x'] }],
      post,
    });
    await service.publish({
      type: 'x',
      scopeId: 's1',
      ref: 'mk://inventory/component/1',
      changed: ['quantity'],
    });
    await settle();
    await service.drain();
    // signer.post(baseUrl, secret, path, payload, timeout)
    const payload = post.mock.calls[0][3] as ExternalWebhookEvent;
    expect(Object.keys(payload).sort()).toEqual(
      [
        'changed',
        'eventId',
        'occurredAt',
        'ref',
        'schemaVersion',
        'scopeId',
        'type',
      ].sort(),
    );
    expect(payload.changed).toEqual(['quantity']);
    expect(payload.schemaVersion).toBe(1);
  });

  it('marks a delivered row and stops retrying it', async () => {
    const post = makePost(true);
    const { service, rows, settle } = makeService({
      subscribers: [{ pluginId: 'a', events: ['x'] }],
      post,
    });
    await service.publish({ type: 'x' });
    await settle();
    await service.drain();
    expect(rows[0].deliveredAt).not.toBeNull();
    await service.drain();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reschedules a failed delivery with a growing backoff', async () => {
    const post = makePost(false, 'http');
    const { service, rows, settle } = makeService({
      subscribers: [{ pluginId: 'a', events: ['x'] }],
      post,
    });
    await service.publish({ type: 'x' });
    await settle();
    await service.drain();
    const first = rows[0].nextAttemptAt?.getTime() ?? 0;
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastError).toBe('http');
    expect(rows[0].deliveredAt).toBeNull();

    // Force the row due again and fail once more: the wait must grow.
    rows[0].nextAttemptAt = new Date(0);
    await service.drain();
    const second = rows[0].nextAttemptAt?.getTime() ?? 0;
    expect(rows[0].attempts).toBe(2);
    expect(second - Date.now()).toBeGreaterThan(first - Date.now());
  });

  it('gives up visibly after the attempt budget, leaving a dead letter', async () => {
    const post = makePost(false, 'network');
    const { service, rows, settle } = makeService({
      subscribers: [{ pluginId: 'a', events: ['x'] }],
      post,
    });
    await service.publish({ type: 'x' });
    await settle();
    for (let i = 0; i < 10; i++) {
      rows[0].nextAttemptAt = new Date(0);
      // The breaker opens along the way; clear it so we exercise the ATTEMPT
      // budget rather than the cooldown.
      (
        service as unknown as { breaker: ExternalBreakerService }
      ).breaker.forget('a');
      await service.drain();
      if (rows[0].deadAt) break;
    }
    expect(rows[0].deadAt).not.toBeNull();
    expect(rows[0].nextAttemptAt).toBeNull();
    expect(rows[0].lastError).toBe('network');
  });
});
