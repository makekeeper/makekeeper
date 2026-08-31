import type {
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { NotifyActionsService } from './notify-actions.service';
import type { NotifyService } from './notify.service';

interface TokenRow {
  token: string;
  notificationId: string;
  scopeId: string | null;
  kind: string;
  hookId: string | null;
  channelId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function build(options: {
  token?: Partial<TokenRow>;
  hookLevel?: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  snoozeResult?: boolean;
  hookThrows?: boolean;
}): {
  service: NotifyActionsService;
  rows: TokenRow[];
  ran: string[];
} {
  const rows: TokenRow[] = [
    {
      token: 'tok',
      notificationId: 'n1',
      scopeId: null,
      kind: 'hook',
      hookId: 'chat.confirm',
      channelId: 'web-push',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      ...options.token,
    },
  ];
  const ran: string[] = [];

  const prisma = {
    notificationActionToken: {
      findFirst: async ({ where }: { where: { token: string } }) =>
        rows.find((row) => row.token === where.token) ?? null,
      // Mirrors Prisma: the filter is honoured (`usedAt: null` only matches an
      // unburned token) and the match count is reported back — that count is
      // the whole of the claim mechanism under test.
      updateMany: async ({
        where,
        data,
      }: {
        where: { token: string; usedAt?: null };
        data: { usedAt: Date | null };
      }) => {
        const matched = rows.filter(
          (entry) =>
            entry.token === where.token &&
            (where.usedAt === undefined || entry.usedAt === null),
        );
        for (const row of matched) row.usedAt = data.usedAt;
        return { count: matched.length };
      },
      deleteMany: async () => undefined,
    },
  } as unknown as PrismaService;

  const context = {
    runWithoutScope: async <T>(_reason: string, fn: () => Promise<T>) => fn(),
    runWithScope: async <T>(_scopeId: string, fn: () => Promise<T>) => fn(),
  } as unknown as RequestContextService;

  const notify = {
    markRead: async () => {
      ran.push('markRead');
    },
    snooze: async () => {
      ran.push('snooze');
      return options.snoozeResult ?? true;
    },
    actionHook: () =>
      options.hookLevel
        ? {
            pluginId: 'chat',
            hook: {
              hookId: 'chat.confirm',
              labelKey: 'x',
              level: options.hookLevel,
            },
            handler: async () => {
              // A tick of real asynchrony, so two presses racing each other
              // actually interleave instead of running one after the other.
              await Promise.resolve();
              ran.push('hook');
              if (options.hookThrows) throw new Error('hook exploded');
            },
          }
        : undefined,
  } as unknown as NotifyService;

  return {
    service: new NotifyActionsService(prisma, notify, context),
    rows,
    ran,
  };
}

describe('NotifyActionsService.redeem', () => {
  it('refuses a token nobody issued', async () => {
    const { service } = build({});
    expect(await service.redeem('nope')).toEqual({ status: 'unknown' });
  });

  it('refuses an expired token', async () => {
    const { service } = build({
      token: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await service.redeem('tok')).toEqual({ status: 'expired' });
  });

  it('refuses a token that has already been pressed', async () => {
    const { service } = build({ token: { usedAt: new Date() } });
    expect(await service.redeem('tok')).toEqual({ status: 'used' });
  });

  it('runs a WRITE hook and burns the token', async () => {
    const { service, rows, ran } = build({ hookLevel: 'WRITE' });
    expect(await service.redeem('tok')).toEqual({ status: 'ok' });
    expect(ran).toContain('hook');
    expect(rows[0]?.usedAt).not.toBeNull();
  });

  it('never lets a DESTRUCTIVE hook be confirmed from a channel', async () => {
    const { service, ran, rows } = build({ hookLevel: 'DESTRUCTIVE' });
    expect(await service.redeem('tok')).toEqual({
      status: 'refused',
      reasonKey: 'notify.actions.destructive',
    });
    expect(ran).not.toContain('hook');
    // Not burned either: refusing is not spending.
    expect(rows[0]?.usedAt).toBeNull();
  });

  it('says so when a hook is no longer registered', async () => {
    const { service } = build({});
    expect(await service.redeem('tok')).toEqual({
      status: 'refused',
      reasonKey: 'notify.actions.unknownHook',
    });
  });

  it('snoozes, and says so when there is nothing to move', async () => {
    const moved = build({ token: { kind: 'snooze' } });
    expect(await moved.service.redeem('tok')).toEqual({ status: 'ok' });

    const stuck = build({ token: { kind: 'snooze' }, snoozeResult: false });
    expect(await stuck.service.redeem('tok')).toEqual({
      status: 'refused',
      reasonKey: 'notify.actions.nothingToSnooze',
    });
  });

  it('dismisses by marking read', async () => {
    const { service, ran } = build({ token: { kind: 'dismiss' } });
    expect(await service.redeem('tok')).toEqual({ status: 'ok' });
    expect(ran).toContain('markRead');
  });

  // #311: "an action token cannot be replayed". Two presses arriving together —
  // a double tap, or a channel that delivered the same button twice — must not
  // both reach the hook.
  it('runs the hook once when two presses arrive together', async () => {
    const { service, ran, rows } = build({ hookLevel: 'WRITE' });
    const [first, second] = await Promise.all([
      service.redeem('tok'),
      service.redeem('tok'),
    ]);
    const outcomes = [first, second];
    expect(outcomes).toContainEqual({ status: 'ok' });
    expect(outcomes).toContainEqual({ status: 'used' });
    expect(ran.filter((entry) => entry === 'hook')).toHaveLength(1);
    expect(rows[0]?.usedAt).not.toBeNull();
  });

  // The other half of the same property: burning the token up front must not
  // cost a person their button when the hook is what broke.
  it('gives the token back when the hook throws', async () => {
    const { service, rows } = build({ hookLevel: 'WRITE', hookThrows: true });
    expect(await service.redeem('tok')).toEqual({
      status: 'refused',
      reasonKey: 'notify.actions.failed',
    });
    expect(rows[0]?.usedAt).toBeNull();
  });
});
