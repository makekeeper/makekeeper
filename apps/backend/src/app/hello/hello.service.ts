import { Injectable } from '@nestjs/common';
import { PrismaService, RequestContextService } from '@makekeeper/backend-core';
import {
  HELLO_NUDGE_AFTER_DAYS,
  type HelloNudgeState,
} from '@makekeeper/plugin-contract';

const SETTINGS_ID = 'default';
const DAY_MS = 24 * 60 * 60 * 1000;

// Prisma's unique-constraint code, read off the error rather than imported
// (the same guard the projects plugin uses for its default group).
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  return err.code === 'P2002';
}

// The say-hello card (#367, #368). Two questions with two owners: WHEN to ask
// belongs to the instance (a week after it first met the feature), and WHETHER
// this person still wants to be asked belongs to them. A star or a release
// subscription is a personal act, so every user is asked and each closes it
// for themselves.
@Injectable()
export class HelloService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  async getState(now: Date = new Date()): Promise<HelloNudgeState> {
    const { firstSeenAt } = await this.ensureSettings();
    const dismissal = await this.findDismissal();
    const due =
      now.getTime() - firstSeenAt.getTime() >= HELLO_NUDGE_AFTER_DAYS * DAY_MS;
    return {
      show: due && dismissal === null,
      firstSeenAt: firstSeenAt.toISOString(),
      dismissedAt: dismissal?.dismissedAt.toISOString() ?? null,
    };
  }

  // Closing is final for the person closing it, and the first close stands.
  // `create`, never `upsert`: the scope policy refuses an upsert on a scoped
  // model (§5.8). `scopeId` is not passed — the policy stamps the owner on a
  // user-bound create, and on a single-user instance it stays NULL. Two tabs
  // closing at once can leave two rows for one person; the lookup takes the
  // earliest, so that is harmless.
  async dismiss(now: Date = new Date()): Promise<HelloNudgeState> {
    if (!(await this.findDismissal())) {
      await this.prisma.helloNudgeDismissal.create({
        data: { dismissedAt: now },
      });
    }
    return this.getState(now);
  }

  // The person's own close. Keyed exactly as the scope policy keys a
  // user-bound row (`userId ?? scopeId`): an admin browsing a shared scope is
  // still the one who closed the card. NULL on a single-user instance, where
  // there is no session.
  private findDismissal(): Promise<{ dismissedAt: Date } | null> {
    const ctx = this.context.get();
    return this.prisma.helloNudgeDismissal.findFirst({
      where: { scopeId: ctx?.userId ?? ctx?.scopeId ?? null },
      orderBy: { dismissedAt: 'asc' },
    });
  }

  // Two first reads at the same moment (two tabs) can both take the upsert's
  // create branch; the loser fails on the primary key. The row it wanted
  // exists by then, so read it instead of failing the request. The settings
  // row is unscoped, so the upsert is allowed here.
  private async ensureSettings(): Promise<{ firstSeenAt: Date }> {
    try {
      return await this.prisma.helloNudgeSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID },
        update: {},
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return this.prisma.helloNudgeSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
    }
  }
}
