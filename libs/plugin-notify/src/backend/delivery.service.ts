import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  AppConfigService,
  CapabilityRegistryService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { NotifyService } from './notify.service';
import {
  isWithinQuietHours,
  NOTIFY_CHANNEL_PREFIX,
  parseNotificationActions,
  parseNotificationParams,
  type NotificationAction,
  type NotificationImportance,
  type NotifyChannelCapability,
  type RenderedNotification,
  type RenderedNotificationAction,
} from '@makekeeper/plugin-contract';

// Give up after eight tries, spread over about two hours — long enough to ride
// out a deploy or a chat service having a bad afternoon, short enough that a
// channel which is simply gone stops being hammered. Same shape as the external
// event outbox, for the same reason: "the app is up, the channel is not" is the
// normal state, not the exception.
const MAX_ATTEMPTS = 8;
const backoffMs = (attempt: number): number =>
  Math.min(30_000 * 2 ** (attempt - 1), 64 * 60_000);

// How long one process owns a delivery it picked up. Long enough to outlast a
// channel's own timeout, short enough that a row is not stranded for the rest of
// the afternoon when the process holding it dies mid-send.
//
// A LEASE, not an "in progress" flag, for exactly that reason: a flag is set by
// a process that may never come back to clear it, and the row it marked would
// wait for a human. Moving `nextAttemptAt` forward means the row simply becomes
// due again if nobody finished it.
const LEASE_MS = 2 * 60_000;

// An action token is worth pressing for a day. Long enough for a notification
// read in the morning, short enough that a forwarded message stops working.
const ACTION_TOKEN_TTL_MS = 24 * 60 * 60_000;

const isImportance = (value: string): value is NotificationImportance =>
  value === 'low' || value === 'normal' || value === 'high';

// What a sweep carries from the row it read to the attempt that claims it.
interface DeliveryRow {
  id: string;
  notificationId: string;
  channelId: string;
  attempts: number;
  nextAttemptAt: Date | null;
}

@Injectable()
export class NotifyDeliveryService {
  private readonly logger = new Logger(NotifyDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly context: RequestContextService,
    private readonly i18n: PluginI18nService,
    private readonly config: AppConfigService,
    // Injected lazily by Nest's forwardRef: the bus posts through the delivery
    // service, and the delivery service asks the bus for the reader's
    // preferences — a genuine two-way relationship between one plugin's own
    // services, not a cross-plugin one.
    @Inject(forwardRef(() => NotifyService))
    private readonly notify: NotifyService,
  ) {}

  channels(): { pluginId: string; impl: NotifyChannelCapability }[] {
    return this.capabilities.getCapabilities<NotifyChannelCapability>(
      NOTIFY_CHANNEL_PREFIX,
    );
  }

  // Queue one notification for every channel that may carry it. Queuing is
  // separate from sending so a slow channel never delays the row appearing in
  // the inbox — which is the one delivery that always works.
  async enqueue(notificationId: string): Promise<void> {
    const row = await this.prisma.notification.findFirst({
      where: { id: notificationId },
    });
    if (!row) return;
    // Low importance stays in the app. That IS what the tier means: worth
    // knowing when you look, not worth a banner on somebody's phone.
    if (row.importance === 'low') return;

    const config = await this.prisma.notificationTypeConfig.findFirst({
      where: { type: row.type },
    });
    const allowed = parseAllowed(config?.allowedJson ?? null);
    // One query for the person's whole row of the matrix, rather than one per
    // channel: the list is small and the loop below is per notification.
    const routes = await this.prisma.notificationRoute.findMany({
      where: { scopeId: row.scopeId, type: row.type },
    });

    for (const channel of this.channels()) {
      const channelId = channel.impl.channelId;
      // A type may forbid a channel outright (a transient hint that has no
      // business waking a phone).
      if (allowed && !allowed.includes(channelId)) continue;
      // The person's master switch for the channel comes first: a channel they
      // do not use carries nothing, whatever the matrix says.
      if (!(await this.notify.channelEnabled(row.scopeId, channelId))) continue;
      const route = routes.find((entry) => entry.channelId === channelId);
      // Absent means "the default", which is on: a person who has connected a
      // channel expects it to carry things until they say otherwise.
      if (route && !route.enabled) continue;
      if (!(await channel.impl.isLinked(row.scopeId))) continue;
      await this.prisma.notificationDelivery.create({
        data: {
          id: generateUuid(),
          notificationId: row.id,
          channelId,
          nextAttemptAt: new Date(),
        },
      });
    }
  }

  // One pass over everything owed. Runs with the policy suspended — deliveries
  // belong to no caller — and renders each in its recipient's own scope.
  async drain(now: Date): Promise<void> {
    const due = await this.context.runWithoutScope('scheduler-tick', () =>
      this.prisma.notificationDelivery.findMany({
        where: {
          deliveredAt: null,
          deadAt: null,
          nextAttemptAt: { lte: now },
        },
        take: 100,
      }),
    );
    for (const delivery of due) {
      try {
        // The row is handed over as this sweep READ it: the claim below has to
        // compare against that moment, and a re-read inside would compare a
        // value the winner has already moved — which is no claim at all.
        await this.attempt(delivery, now);
      } catch (err) {
        this.logger.error(
          `Delivery ${delivery.id} failed hard: ${getErrorMessage(err)}`,
        );
      }
    }
  }

  private async attempt(delivery: DeliveryRow, now: Date): Promise<void> {
    await this.context.runWithoutScope('scheduler-tick', async () => {
      // Claim it before sending. One process guards itself with a flag on the
      // job; TWO — a redeploy overlapping its predecessor, a second replica, a
      // stray dev instance — do not, and the cost of that is somebody being
      // told the same thing twice. Same compare-and-set the scheduler claims a
      // firing with, and it sits before `render`, so nothing is even built for
      // a delivery this process does not own.
      if (!(await this.claim(delivery, now))) return;
      const row = await this.prisma.notification.findFirst({
        where: { id: delivery.notificationId },
      });
      if (!row) {
        // The notification was deleted while the delivery waited: there is
        // nothing left to say, and a dead letter about it would be noise.
        await this.prisma.notificationDelivery.deleteMany({
          where: { id: delivery.id },
        });
        return;
      }

      const channel = this.channels().find(
        (entry) => entry.impl.channelId === delivery.channelId,
      );
      if (!channel) {
        // The channel plugin is disabled or gone. Held, not killed: switching
        // it back on should deliver what is still worth delivering.
        await this.prisma.notificationDelivery.updateMany({
          where: { id: delivery.id },
          data: { nextAttemptAt: new Date(now.getTime() + backoffMs(3)) },
        });
        return;
      }

      // Quiet hours hold the CHANNEL, never the inbox: the row has been in the
      // app since it was posted; what the window buys is not being woken.
      const held = await this.quietUntil(row.scopeId, now);
      if (held) {
        await this.prisma.notificationDelivery.updateMany({
          where: { id: delivery.id },
          data: { nextAttemptAt: held },
        });
        return;
      }

      const message = await this.render(row, delivery.channelId);
      try {
        await channel.impl.deliver(message);
        await this.prisma.notificationDelivery.updateMany({
          where: { id: delivery.id },
          data: { deliveredAt: new Date(), lastError: null },
        });
      } catch (err) {
        const attempts = delivery.attempts + 1;
        const exhausted = attempts >= MAX_ATTEMPTS;
        await this.prisma.notificationDelivery.updateMany({
          where: { id: delivery.id },
          data: {
            attempts,
            lastError: getErrorMessage(err),
            // Visibly dead rather than quietly retried forever: "why did
            // nothing reach my phone" has to have an answer.
            deadAt: exhausted ? new Date() : null,
            nextAttemptAt: exhausted
              ? null
              : new Date(now.getTime() + backoffMs(attempts)),
          },
        });
      }
    });
  }

  // Take the delivery, but only if it is still exactly where this sweep found
  // it. `updateMany` reports how many rows matched, which is the whole of the
  // mechanism: 1 means we own this attempt, 0 means somebody else already does.
  //
  // The lease is written into `nextAttemptAt` itself, so every branch below that
  // sets its own value — backoff, quiet hours, a missing channel, a dead letter
  // — simply overwrites it, and none of them has to know a lease exists.
  private async claim(delivery: DeliveryRow, now: Date): Promise<boolean> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        nextAttemptAt: delivery.nextAttemptAt,
        deliveredAt: null,
        deadAt: null,
      },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    return result.count === 1;
  }

  // When the recipient's quiet window ends, or null when it is not quiet now.
  private async quietUntil(
    scopeId: string | null,
    now: Date,
  ): Promise<Date | null> {
    const prefs = await this.prisma.notifyPreference.findFirst({
      where: { scopeId },
    });
    // `=== null`, never falsy: 0 is midnight, and a window starting at 00:00 is
    // the most ordinary one there is.
    if (
      prefs?.quietFromMinutes === undefined ||
      prefs.quietFromMinutes === null ||
      prefs.quietToMinutes === null
    ) {
      return null;
    }
    const timezone = prefs.timezone ?? undefined;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now);
    const at = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const minutes = (at('hour') % 24) * 60 + at('minute');
    const quiet = {
      quietFromMinutes: prefs.quietFromMinutes,
      quietToMinutes: prefs.quietToMinutes,
      timezone: prefs.timezone,
      locale: prefs.locale,
    };
    if (!isWithinQuietHours(quiet, minutes)) return null;
    // Minutes until the window's end, wrapping past midnight.
    const until = prefs.quietToMinutes;
    const delta = until > minutes ? until - minutes : 24 * 60 - minutes + until;
    return new Date(now.getTime() + delta * 60_000);
  }

  // Text is built HERE, once per delivery, in the recipient's own language —
  // never by the emitter, which usually is not the person being told (§5.5).
  private async render(
    row: {
      id: string;
      scopeId: string | null;
      titleKey: string;
      bodyKey: string | null;
      paramsJson: string | null;
      actionsJson: string | null;
      ref: string | null;
      importance: string;
    },
    channelId: string,
  ): Promise<RenderedNotification> {
    const prefs = await this.prisma.notifyPreference.findFirst({
      where: { scopeId: row.scopeId },
    });
    const locale = prefs?.locale ?? undefined;
    const params = parseNotificationParams(row.paramsJson) ?? {};
    const actions = parseNotificationActions(row.actionsJson);
    const rendered: RenderedNotificationAction[] = [];
    for (const action of actions) {
      // `open` needs no authority — it is a link — and DESTRUCTIVE never leaves
      // the app whatever a channel would like to render.
      if (action.kind === 'open') continue;
      const token = await this.issueToken(
        row.id,
        row.scopeId,
        action,
        channelId,
      );
      if (!token) continue;
      rendered.push({
        kind: action.kind,
        label: this.i18n.t(labelKeyOf(action), {}, locale),
        token,
      });
    }
    return {
      notificationId: row.id,
      recipientUserId: row.scopeId,
      title: this.i18n.t(row.titleKey, params, locale),
      body: row.bodyKey ? this.i18n.t(row.bodyKey, params, locale) : undefined,
      url: row.ref ? this.urlFor(row.ref) : undefined,
      importance: isImportance(row.importance) ? row.importance : 'normal',
      actions: rendered,
    };
  }

  private async issueToken(
    notificationId: string,
    scopeId: string | null,
    action: NotificationAction,
    channelId: string,
  ): Promise<string | null> {
    if (action.kind === 'open') return null;
    const token = generateUuid();
    await this.prisma.notificationActionToken.create({
      data: {
        token,
        notificationId,
        scopeId,
        kind: action.kind,
        hookId: action.kind === 'hook' ? action.hookId : null,
        channelId,
        expiresAt: new Date(Date.now() + ACTION_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  // A link a person can follow from outside the app. Only the CONFIGURED base
  // URL will do: there is no request to derive one from out here, and guessing
  // would hand somebody a link that resolves on the server's own loopback.
  // Without it the message simply carries no link (§5.2).
  private urlFor(ref: string): string | undefined {
    const base = this.config.getPublicBaseUrlOverride();
    if (!base) return undefined;
    return `${base.replace(/\/$/, '')}/r/${encodeURIComponent(ref)}`;
  }
}

const labelKeyOf = (action: NotificationAction): string => {
  if (action.kind === 'hook') return action.labelKey;
  return action.labelKey ?? `notify.actions.${action.kind}`;
};

const parseAllowed = (raw: string | null): string[] | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : null;
  } catch {
    return null;
  }
};
