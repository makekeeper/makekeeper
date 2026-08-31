import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  RequestContextService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { NotifyService } from './notify.service';

// The outcome of pressing a button that arrived in somebody's chat client or
// phone. A union rather than a boolean: "already pressed" and "expired" are
// different things to say to a person, and both are different from "no".
export type ActionOutcome =
  | { status: 'ok' }
  | { status: 'unknown' }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'refused'; reasonKey: string };

// How long a snooze from a channel lasts. The same hour the in-app button uses:
// two places offering "later" that mean different amounts of later is worse
// than either choice.
const SNOOZE_MINUTES = 60;

@Injectable()
export class NotifyActionsService {
  private readonly logger = new Logger(NotifyActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly context: RequestContextService,
  ) {}

  // Redeem a single-use action token (#311).
  //
  // The token IS the authority — the press arrives without a session, from
  // whatever client the channel put it in — so everything about it is checked
  // here: that it exists, has not expired, has not been used, and that what it
  // asks for is something a channel is allowed to do at all.
  async redeem(token: string): Promise<ActionOutcome> {
    return this.context.runWithoutScope('scheduler-tick', async () => {
      const row = await this.prisma.notificationActionToken.findFirst({
        where: { token },
      });
      if (!row) return { status: 'unknown' };
      if (row.usedAt) return { status: 'used' };
      if (row.expiresAt.getTime() < Date.now()) return { status: 'expired' };

      // Burn the token BEFORE running anything, by the same compare-and-set a
      // delivery uses to claim itself (#328): the read above is only a cheap
      // early exit, and two presses that pass it together — a double tap on a
      // push button, a channel that delivered twice — would otherwise both run
      // the hook. `updateMany` reporting 1 is what makes this press the only
      // one; 0 means somebody else got there between the read and here.
      //
      // The stamp is released again on failure (below), so the property #311
      // actually asks for is kept in both directions: a hook that ran cannot be
      // replayed, a hook that broke can still be pressed once it is fixed.
      const claimed = await this.prisma.notificationActionToken.updateMany({
        where: { token, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return { status: 'used' };

      const run = async (): Promise<ActionOutcome> => {
        if (row.kind === 'dismiss') {
          await this.notify.markRead(row.notificationId);
          return { status: 'ok' };
        }
        if (row.kind === 'snooze') {
          const moved = await this.notify.snooze(
            row.notificationId,
            SNOOZE_MINUTES,
          );
          return moved
            ? { status: 'ok' }
            : {
                status: 'refused',
                reasonKey: 'notify.actions.nothingToSnooze',
              };
        }
        const hook = row.hookId
          ? this.notify.actionHook(row.hookId)
          : undefined;
        if (!hook) {
          return { status: 'refused', reasonKey: 'notify.actions.unknownHook' };
        }
        // The rule the whole channel design rests on: a WRITE may be confirmed
        // from outside the app, a DESTRUCTIVE never may. Checked at the press,
        // not at render time, so a token issued before a hook was reclassified
        // still cannot get through.
        if (hook.hook.level === 'DESTRUCTIVE') {
          return { status: 'refused', reasonKey: 'notify.actions.destructive' };
        }
        await hook.handler({
          notificationId: row.notificationId,
          recipientUserId: row.scopeId,
          params: {},
        });
        await this.notify.markRead(row.notificationId);
        return { status: 'ok' };
      };

      try {
        // Everything runs as the RECIPIENT: the press carries their authority
        // and nobody else's, whichever client it came from.
        const outcome = row.scopeId
          ? await this.context.runWithScope(row.scopeId, run)
          : await run();
        // Nothing happened, so the press should not have cost the token.
        if (outcome.status !== 'ok') await this.release(token);
        return outcome;
      } catch (err) {
        await this.release(token);
        this.logger.warn(
          `Action token ${token} failed: ${getErrorMessage(err)}`,
        );
        return { status: 'refused', reasonKey: 'notify.actions.failed' };
      }
    });
  }

  // Give the token back after an attempt that changed nothing. Unconditional on
  // purpose: the claim above is what proves this press owns the row, so there is
  // nobody else's stamp here to wipe.
  private async release(token: string): Promise<void> {
    await this.prisma.notificationActionToken.updateMany({
      where: { token },
      data: { usedAt: null },
    });
  }

  // Tokens outlive their usefulness within a day; sweeping them keeps the table
  // from becoming a log of every button ever rendered.
  async purgeExpired(now: Date): Promise<void> {
    await this.context.runWithoutScope('scheduler-tick', async () => {
      await this.prisma.notificationActionToken.deleteMany({
        where: {
          expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) },
        },
      });
    });
  }
}
