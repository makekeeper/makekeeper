import { HelloService } from './hello.service';

// What these guard: the instance's week, not a day earlier; each person's
// close is their own (#368) and the first one stands; a single-user instance
// still works with no session at all; and a lost creation race is not an error.

type Dismissal = { id: string; scopeId: string | null; dismissedAt: Date };

const DAY = 24 * 60 * 60 * 1000;
const WEEK_OLD = new Date('2026-10-01T00:00:00Z');
const LATER = new Date('2026-10-18T00:00:00Z');

const makeService = (
  options: { firstSeenAt?: Date | null; raceOnCreate?: boolean } = {},
) => {
  let settings: { firstSeenAt: Date } | null =
    options.firstSeenAt === undefined
      ? { firstSeenAt: WEEK_OLD }
      : options.firstSeenAt && { firstSeenAt: options.firstSeenAt };
  let raced = false;
  const dismissals: Dismissal[] = [];
  let userId: string | undefined;
  const prisma = {
    helloNudgeSettings: {
      upsert: jest.fn(async () => {
        if (options.raceOnCreate && !raced && settings === null) {
          raced = true;
          settings = { firstSeenAt: WEEK_OLD };
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        settings ??= { firstSeenAt: new Date() };
        return settings;
      }),
      findUniqueOrThrow: jest.fn(async () => {
        if (!settings) throw new Error('missing');
        return settings;
      }),
    },
    helloNudgeDismissal: {
      findFirst: jest.fn(
        async ({ where }: { where: { scopeId: string | null } }) =>
          dismissals.find((d) => d.scopeId === where.scopeId) ?? null,
      ),
      // Stands in for the scope policy: a user-bound create is stamped with
      // its owner; with multi-user mode off, scopeId stays NULL.
      create: jest.fn(async ({ data }: { data: { dismissedAt: Date } }) => {
        const row = {
          id: `row-${dismissals.length + 1}`,
          scopeId: userId ?? null,
          dismissedAt: data.dismissedAt,
        };
        dismissals.push(row);
        return row;
      }),
    },
  };
  const context = {
    get: () => (userId ? { userId, scopeId: userId } : undefined),
  };
  const service = new HelloService(prisma as never, context as never);
  return {
    service,
    dismissals,
    as: (id: string | undefined) => {
      userId = id;
    },
  };
};

describe('HelloService', () => {
  it('mints the instance date on the first read and does not show the card yet', async () => {
    const { service } = makeService({ firstSeenAt: null });
    const state = await service.getState();
    expect(state.show).toBe(false);
    expect(state.dismissedAt).toBeNull();
  });

  it('shows the card once the instance is a week old, not a minute earlier', async () => {
    const firstSeenAt = new Date('2026-10-01T12:00:00Z');
    const { service } = makeService({ firstSeenAt });
    const almost = new Date(firstSeenAt.getTime() + 7 * DAY - 60 * 1000);
    const week = new Date(firstSeenAt.getTime() + 7 * DAY);
    expect((await service.getState(almost)).show).toBe(false);
    expect((await service.getState(week)).show).toBe(true);
  });

  it("one person's close hides the card for them only", async () => {
    const { service, as } = makeService();
    as('alice');
    await service.dismiss(LATER);
    expect((await service.getState(LATER)).show).toBe(false);

    as('bob');
    expect((await service.getState(LATER)).show).toBe(true);
  });

  it('keeps the first close when the same person closes twice', async () => {
    const { service, as, dismissals } = makeService();
    as('alice');
    const t1 = new Date('2026-10-17T00:00:00Z');
    await service.dismiss(t1);
    const second = await service.dismiss(LATER);
    expect(dismissals).toHaveLength(1);
    expect(second.dismissedAt).toBe(t1.toISOString());
  });

  it('a single-user instance closes it with no owner at all', async () => {
    const { service, as, dismissals } = makeService();
    as(undefined);
    const state = await service.dismiss(LATER);
    expect(state.show).toBe(false);
    expect(dismissals[0]?.scopeId).toBeNull();
  });

  // Regression: the row id used to be "solo". Backfill hands a solo close to the
  // first admin when multi-user mode is turned on; turned off again, the solo
  // reader's close collided with that row's id, was swallowed, and the card
  // could never be closed.
  it('can still be closed on a single-user instance after a multi-user round trip', async () => {
    const { service, as, dismissals } = makeService();
    dismissals.push({ id: 'row-0', scopeId: 'admin-id', dismissedAt: LATER });
    as(undefined);
    expect((await service.getState(LATER)).show).toBe(true);
    expect((await service.dismiss(LATER)).show).toBe(false);
  });

  it('a first read that loses the creation race reads the winner instead of failing', async () => {
    const { service } = makeService({ firstSeenAt: null, raceOnCreate: true });
    const state = await service.getState(LATER);
    expect(state.firstSeenAt).toBe(WEEK_OLD.toISOString());
    expect(state.show).toBe(true);
  });
});
