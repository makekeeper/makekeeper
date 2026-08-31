import { PermissionLevel } from '@makekeeper/plugin-contract';
import type {
  CapabilityRegistryService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type {
  CalendarSourceCapability,
  ScheduleHookContext,
} from '@makekeeper/plugin-contract';
import { ScheduleRefused, ScheduleService } from './schedule.service';

const DAILY_10 = 'DTSTART:20260105T100000\nRRULE:FREQ=DAILY';

interface Row {
  id: string;
  scopeId: string | null;
  ownerUserId: string | null;
  hookId: string;
  title: string;
  triggerKind: string;
  rrule: string | null;
  timezone: string | null;
  ref: string | null;
  refField: string | null;
  offsetMinutes: number | null;
  paramsJson: string | null;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  createdAt: Date;
}

interface Harness {
  service: ScheduleService;
  shared: Row[];
  runs: { outcome: string; detail: string | null; occurrences: number }[];
  fired: ScheduleHookContext[];
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 's1',
    scopeId: null,
    ownerUserId: null,
    hookId: 'notify.say',
    title: 'Put the part on the printer',
    triggerKind: 'absolute',
    rrule: DAILY_10,
    timezone: 'Europe/Moscow',
    ref: null,
    refField: null,
    offsetMinutes: null,
    paramsJson: null,
    enabled: true,
    nextRunAt: new Date('2026-01-05T07:00:00Z'),
    lastRunAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildHarness(options?: {
  rows?: Row[];
  calendar?: CalendarSourceCapability;
}): Harness {
  const shared = options?.rows ?? [];
  const runs: Harness['runs'] = [];
  const fired: ScheduleHookContext[] = [];

  const empty = { findMany: async () => [], findFirst: async () => null };
  const prisma = {
    schedule: {
      findMany: async () => shared,
      findFirst: async ({ where }: { where: { id: string } }) =>
        shared.find((entry) => entry.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => {
        // The real column has a default; the fake supplies it so `toView` sees
        // the row Prisma would have returned.
        const stored = { ...data, createdAt: data.createdAt ?? new Date() };
        shared.push(stored);
        return stored;
      },
      // Models the real compare-and-set: a claim matches only while the row's
      // clock is still where the sweep read it, and reports how many rows it
      // moved — which is what stops two processes firing one moment twice.
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; nextRunAt?: Date | null };
        data: Partial<Row>;
      }) => {
        const target = shared.find(
          (entry) =>
            entry.id === where.id &&
            (where.nextRunAt === undefined ||
              entry.nextRunAt?.getTime() === where.nextRunAt?.getTime()),
        );
        if (target) Object.assign(target, data);
        return { count: target ? 1 : 0 };
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const index = shared.findIndex((entry) => entry.id === where.id);
        if (index >= 0) shared.splice(index, 1);
      },
    },
    personalSchedule: {
      ...empty,
      create: async ({ data }: { data: Row }) => ({
        ...data,
        createdAt: data.createdAt ?? new Date(),
      }),
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => undefined,
    },
    scheduleRun: {
      create: async ({
        data,
      }: {
        data: { outcome: string; detail: string | null; occurrences: number };
      }) => {
        runs.push(data);
      },
    },
  } as unknown as PrismaService;

  const context = {
    get: () => ({ scopeId: null, userId: null }),
    runWithoutScope: async <T>(_reason: string, fn: () => Promise<T>) => fn(),
    runWithScope: async <T>(_scopeId: string, fn: () => Promise<T>) => fn(),
  } as unknown as RequestContextService;

  const capabilities = {
    getCapability: () => options?.calendar ?? null,
  } as unknown as CapabilityRegistryService;

  const service = new ScheduleService(prisma, context, capabilities);
  service.registerHook(
    'notify',
    {
      hookId: 'notify.say',
      labelKey: 'notify.hook.say',
      level: PermissionLevel.READ,
      misfire: 'collapse',
    },
    async (ctx) => {
      fired.push(ctx);
    },
  );
  service.registerHook(
    'logistics',
    {
      hookId: 'logistics.reorder',
      labelKey: 'logistics.hook.reorder',
      level: PermissionLevel.WRITE,
      misfire: 'skip',
    },
    async (ctx) => {
      fired.push(ctx);
    },
  );
  service.registerHook(
    'inventory',
    {
      hookId: 'inventory.wipe',
      labelKey: 'inventory.hook.wipe',
      level: PermissionLevel.DESTRUCTIVE,
      misfire: 'skip',
    },
    async () => undefined,
  );
  return { service, shared, runs, fired };
}

describe('ScheduleService.create', () => {
  it('refuses to schedule a DESTRUCTIVE hook at all', async () => {
    const { service } = buildHarness();
    await expect(
      service.create({
        hookId: 'inventory.wipe',
        title: 'nightly wipe',
        trigger: { kind: 'absolute', rrule: DAILY_10, timezone: 'UTC' },
      }),
    ).rejects.toThrow(ScheduleRefused);
  });

  it('refuses a zone the server does not know', async () => {
    const { service } = buildHarness();
    await expect(
      service.create({
        hookId: 'notify.say',
        title: 'x',
        trigger: {
          kind: 'absolute',
          rrule: DAILY_10,
          timezone: 'Mars/Olympus',
        },
      }),
    ).rejects.toMatchObject({ reasonKey: 'schedule.errors.unknownTimezone' });
  });

  it('computes the first firing at creation', async () => {
    const { service } = buildHarness();
    const view = await service.create({
      hookId: 'notify.say',
      title: 'x',
      trigger: { kind: 'absolute', rrule: DAILY_10, timezone: 'Europe/Moscow' },
    });
    expect(view.nextRunAt).not.toBeNull();
  });

  // The agent asked for "remind me" and everyone in the workspace got it
  // (#317). Of the two possible mistakes only one is loud, so absent means
  // mine, and sharing takes saying so.
  it('keeps a reminder to the creator when nobody said to share it', async () => {
    const { service } = buildHarness();
    const view = await service.create({
      hookId: 'notify.say',
      title: 'x',
      trigger: { kind: 'absolute', rrule: DAILY_10, timezone: 'UTC' },
    });
    expect(view.personal).toBe(true);
  });

  // The rule the agent actually sent: an interval with no DTSTART, which rrule
  // anchors at parse time, so its single occurrence is already behind us (#318).
  it('refuses a rule with nothing left ahead of it', async () => {
    const { service } = buildHarness();
    await expect(
      service.create({
        hookId: 'notify.say',
        title: 'look at the clock',
        trigger: {
          kind: 'absolute',
          rrule: 'RRULE:FREQ=MINUTELY;INTERVAL=2;COUNT=1',
          timezone: 'UTC',
        },
      }),
    ).rejects.toMatchObject({ reasonKey: 'schedule.errors.nothingAhead' });
  });

  it('shares one only when asked in so many words', async () => {
    const { service } = buildHarness();
    const view = await service.create({
      hookId: 'notify.say',
      title: 'x',
      trigger: { kind: 'absolute', rrule: DAILY_10, timezone: 'UTC' },
      personal: false,
    });
    expect(view.personal).toBe(false);
  });
});

describe('ScheduleService.runDue', () => {
  it('fires on time and moves to the next occurrence', async () => {
    const harness = buildHarness({ rows: [row()] });
    await harness.service.runDue(new Date('2026-01-05T07:00:30Z'));
    expect(harness.fired).toHaveLength(1);
    expect(harness.runs[0]?.outcome).toBe('ok');
    expect(harness.shared[0]?.nextRunAt?.toISOString()).toBe(
      '2026-01-06T07:00:00.000Z',
    );
  });

  it('collapses a week of missed reminders into one that says so', async () => {
    const harness = buildHarness({ rows: [row()] });
    // Due Monday morning; the box comes back late on the same day.
    await harness.service.runDue(new Date('2026-01-05T20:00:00Z'));
    expect(harness.fired).toHaveLength(1);
    expect(harness.fired[0]?.occurrences).toBeGreaterThan(0);
  });

  it('does not catch up a hook that writes data', async () => {
    const harness = buildHarness({
      rows: [row({ hookId: 'logistics.reorder' })],
    });
    await harness.service.runDue(new Date('2026-01-05T20:00:00Z'));
    expect(harness.fired).toHaveLength(0);
    expect(harness.runs[0]).toMatchObject({
      outcome: 'skipped',
      detail: 'schedule.run.missedWrite',
    });
  });

  it('skips a firing missed for longer than the grace window', async () => {
    const harness = buildHarness({ rows: [row()] });
    await harness.service.runDue(new Date('2026-01-12T07:00:00Z'));
    expect(harness.fired).toHaveLength(0);
    expect(harness.runs[0]).toMatchObject({
      outcome: 'skipped',
      detail: 'schedule.run.tooLate',
    });
  });

  it('fires one due moment once, however many sweeps see it', async () => {
    // The live case: two app processes (a redeploy overlapping its
    // predecessor) both read the same due row. Only the one that moves the
    // clock may run the hook.
    const harness = buildHarness({ rows: [row()] });
    const now = new Date('2026-01-05T07:00:30Z');
    await Promise.all([
      harness.service.runDue(now),
      harness.service.runDue(now),
    ]);
    expect(harness.fired).toHaveLength(1);
  });

  it('keeps the clock moving when the owning plugin is gone', async () => {
    const harness = buildHarness({ rows: [row({ hookId: 'gone.hook' })] });
    await harness.service.runDue(new Date('2026-01-05T07:00:30Z'));
    expect(harness.runs[0]).toMatchObject({
      outcome: 'skipped',
      detail: 'schedule.run.noHook',
    });
    expect(harness.shared[0]?.nextRunAt).not.toBeNull();
  });
});

describe('a relative trigger', () => {
  const relative = row({
    triggerKind: 'relative',
    rrule: null,
    timezone: null,
    ref: 'mk://projects/task/t1',
    refField: 'dueDate',
    offsetMinutes: -60,
  });

  it('follows the object’s date wherever it has moved to', async () => {
    const calendar: CalendarSourceCapability = {
      itemsInRange: async () => [],
      dateOf: async () => '2026-02-01T12:00:00.000Z',
    };
    const harness = buildHarness({ rows: [relative], calendar });
    await harness.service.runDue(new Date('2026-01-05T07:00:30Z'));
    // An hour before the new due date, without anything having been emitted.
    expect(harness.shared[0]?.nextRunAt?.toISOString()).toBe(
      '2026-02-01T11:00:00.000Z',
    );
  });

  it('parks when the object no longer has that date', async () => {
    const calendar: CalendarSourceCapability = {
      itemsInRange: async () => [],
      dateOf: async () => null,
    };
    const harness = buildHarness({ rows: [relative], calendar });
    await harness.service.runDue(new Date('2026-01-05T07:00:30Z'));
    expect(harness.shared[0]?.nextRunAt).toBeNull();
  });
});

describe('ScheduleService.snooze', () => {
  it('moves the next firing without touching the rule', async () => {
    const harness = buildHarness({ rows: [row()] });
    expect(await harness.service.snooze('s1', 60)).toBe(true);
    expect(harness.shared[0]?.rrule).toBe(DAILY_10);
    expect(harness.shared[0]?.nextRunAt?.getTime()).toBeGreaterThan(
      Date.now() + 59 * 60_000,
    );
  });
});
