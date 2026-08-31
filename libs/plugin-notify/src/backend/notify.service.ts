import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CapabilityRegistryService,
  PrismaService,
  RealtimeService,
  RequestContextService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { NotifyDeliveryService } from './delivery.service';
import {
  NOTIFY_INBOX_CHANGED_EVENT,
  SCHEDULE_CAPABILITY,
  SCOPE_DIRECTORY_CAPABILITY,
  isWithinQuietHours,
  notifyInboxRoom,
  parseNotificationActions,
  parseNotificationParams,
  type NotificationImportance,
  type NotificationInput,
  type NotificationTarget,
  type NotificationActionHandler,
  type NotificationActionHook,
  type NotificationTypeDeclaration,
  type NotificationView,
  type NotifyInboxChangedPayload,
  type NotifyPreferences,
  type ScheduleCapability,
  type ScopeDirectoryCapability,
} from '@makekeeper/plugin-contract';

// Fixed row id for the single-user instance's preferences: there is exactly one
// reader and no user id to key them by, and a nullable primary key does not
// exist. Every multiuser row is keyed by the reader's own id, so the two cannot
// collide (a uuid is never this string).
const SOLO_PREFERENCE_ID = 'solo';

const isImportance = (value: string): value is NotificationImportance =>
  value === 'low' || value === 'normal' || value === 'high';

// The bus (#307). Posting is fan-out on write: an audience is expanded into one
// row per recipient here, rather than stored once and expanded when somebody
// reads. Read state, delivery attempts and quiet hours are all per person, so
// the shared row would need a child table for each of them — and "who could see
// this" would be answered long after the grant that answered it may have gone.
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  // Types declared by plugins this boot, keyed by type id. The DB row is the
  // configuration; this map is what the settings UI lists and what `post`
  // validates against.
  private readonly declarations = new Map<
    string,
    NotificationTypeDeclaration & { pluginId: string }
  >();
  private readonly actionHooks = new Map<
    string,
    {
      pluginId: string;
      hook: NotificationActionHook;
      handler: NotificationActionHandler;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly realtime: RealtimeService,
    private readonly capabilities: CapabilityRegistryService,
    @Inject(forwardRef(() => NotifyDeliveryService))
    private readonly delivery: NotifyDeliveryService,
  ) {}

  // ── Type declarations ─────────────────────────────────────────────────────

  declareTypes(pluginId: string, types: NotificationTypeDeclaration[]): void {
    for (const declaration of types) {
      this.declarations.set(declaration.type, { ...declaration, pluginId });
    }
    // Seeding touches the database, and `onModuleInit` is not the place to wait
    // for it: a failure here must cost the seed, never the boot.
    void this.seedConfigs(pluginId, types).catch((err) =>
      this.logger.error(
        `Seeding notification types of "${pluginId}" failed: ${getErrorMessage(err)}`,
      ),
    );
  }

  listDeclarations(): (NotificationTypeDeclaration & { pluginId: string })[] {
    return [...this.declarations.values()];
  }

  // ── Action hooks ──────────────────────────────────────────────────────────

  // What a notification's button may do, offered by the plugin that owns the
  // act. Pressing one is authorised by a single-use token; the LEVEL is checked
  // where the press lands, so a channel cannot offer its way past §5.7.
  registerActionHook(
    pluginId: string,
    hook: NotificationActionHook,
    handler: NotificationActionHandler,
  ): void {
    this.actionHooks.set(hook.hookId, { pluginId, hook, handler });
  }

  actionHook(hookId: string):
    | {
        pluginId: string;
        hook: NotificationActionHook;
        handler: NotificationActionHandler;
      }
    | undefined {
    return this.actionHooks.get(hookId);
  }

  // Write the default for a type that has never been configured, and leave an
  // existing row completely alone — the person's choice outlives a redeploy
  // (§5.7's rule for tool confirmation policy, for the same reason).
  private async seedConfigs(
    pluginId: string,
    types: NotificationTypeDeclaration[],
  ): Promise<void> {
    for (const declaration of types) {
      const existing = await this.prisma.notificationTypeConfig.findFirst({
        where: { type: declaration.type },
      });
      if (existing) continue;
      await this.prisma.notificationTypeConfig.create({
        data: {
          type: declaration.type,
          pluginId,
          importance: declaration.defaultImportance ?? 'normal',
          allowedJson: declaration.allowedChannels
            ? JSON.stringify(declaration.allowedChannels)
            : null,
        },
      });
    }
  }

  // ── Posting ───────────────────────────────────────────────────────────────

  async post(input: NotificationInput): Promise<void> {
    const declaration = this.declarations.get(input.type);
    if (!declaration) {
      // An undeclared type has no configuration and no row in the settings
      // matrix — it would be unconfigurable noise. Refusing loudly in the log
      // (never in the emitter's flow) is what keeps the matrix complete.
      this.logger.warn(`Refusing undeclared notification type "${input.type}"`);
      return;
    }
    const config = await this.prisma.notificationTypeConfig.findFirst({
      where: { type: input.type },
    });
    if (config && !config.enabled) return;

    const importance =
      input.importance ??
      (config && isImportance(config.importance)
        ? config.importance
        : (declaration.defaultImportance ?? 'normal'));

    const recipients = await this.resolveRecipients(input.target);
    if (recipients.length === 0) {
      // Nobody to tell is not nothing to say: an audience that resolves to an
      // empty list means a scope with no owner, a blocked account, or a target
      // the overlay could not place — all of which look identical to a silently
      // dropped notification unless they are said out loud.
      this.logger.warn(
        `Notification "${input.type}" reached nobody: its target resolved to an empty audience`,
      );
      return;
    }
    for (const recipient of recipients) {
      await this.storeFor(recipient, input, declaration.pluginId, importance);
    }
  }

  // Who a target names. The bus asks the overlay and never learns what a grant
  // is; with multiuser off the capability is unresolvable and every audience
  // collapses to the instance's single reader (`null`).
  private async resolveRecipients(
    target: NotificationTarget,
  ): Promise<(string | null)[]> {
    if (target.kind === 'user') return [target.userId];
    const directory = this.capabilities.getCapability<ScopeDirectoryCapability>(
      SCOPE_DIRECTORY_CAPABILITY,
    );
    if (!directory) return [null];
    if (target.kind === 'audience') {
      return directory.audienceUserIds(
        target.audience,
        target.scopeId ?? this.context.get()?.scopeId ?? null,
      );
    }
    // Topics have no subscriber table yet — a topic addresses the scope that
    // owns it, which is the behaviour a subscription list would start from.
    return directory.audienceUserIds(
      'scope',
      target.scopeId ?? this.context.get()?.scopeId ?? null,
    );
  }

  // Store one notification for one recipient. Runs in the RECIPIENT's scope:
  // the row is user-bound, and the poster is rarely the person being told.
  private async storeFor(
    recipient: string | null,
    input: NotificationInput,
    pluginId: string,
    importance: NotificationImportance,
  ): Promise<void> {
    const write = async (): Promise<void> => {
      if (input.dedupKey) {
        // Fold into the recipient's UNREAD row of the same key. A read one is
        // finished business: repeating the fact deserves to be noticed again.
        const existing = await this.prisma.notification.findFirst({
          where: { scopeId: recipient, dedupKey: input.dedupKey, readAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          await this.prisma.notification.update({
            where: { id: existing.id },
            data: {
              occurrences: { increment: 1 },
              titleKey: input.titleKey,
              bodyKey: input.bodyKey ?? null,
              paramsJson: input.params ? JSON.stringify(input.params) : null,
              ref: input.ref ?? null,
              importance,
            },
          });
          return;
        }
      }
      const created = generateUuid();
      await this.prisma.notification.create({
        data: {
          id: created,
          scopeId: recipient,
          type: input.type,
          pluginId,
          titleKey: input.titleKey,
          bodyKey: input.bodyKey ?? null,
          paramsJson: input.params ? JSON.stringify(input.params) : null,
          ref: input.ref ?? null,
          importance,
          actionsJson: input.actions ? JSON.stringify(input.actions) : null,
          dedupKey: input.dedupKey ?? null,
        },
      });
      // Channels carry NEW facts. A fold into an existing unread row updated
      // something the person has already been told about once — telling them
      // again on every poll is exactly the noise `dedupKey` exists to stop.
      await this.delivery.enqueue(created);
    };

    try {
      if (recipient === null) {
        await write();
      } else {
        await this.context.runWithScope(recipient, write);
      }
      await this.pushInbox(recipient);
    } catch (err) {
      // A broken inbox must never fail the emitter's flow, exactly like a
      // listener on the domain-event bus.
      this.logger.error(
        `Storing notification "${input.type}" failed: ${getErrorMessage(err)}`,
      );
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  private currentScope(): string | null {
    return this.context.get()?.scopeId ?? null;
  }

  async list(limit: number, unreadOnly: boolean): Promise<NotificationView[]> {
    const rows = await this.prisma.notification.findMany({
      where: unreadOnly ? { readAt: null } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toView(row));
  }

  async unreadCounts(
    scopeId: string | null,
  ): Promise<NotifyInboxChangedPayload> {
    const rows = await this.prisma.notification.groupBy({
      by: ['pluginId'],
      where: { scopeId, readAt: null },
      _count: { _all: true },
    });
    const unreadByPlugin: Record<string, number> = {};
    let unread = 0;
    for (const row of rows) {
      unreadByPlugin[row.pluginId] = row._count._all;
      unread += row._count._all;
    }
    return { unread, unreadByPlugin };
  }

  async markRead(id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
    await this.pushInbox(this.currentScope());
  }

  async markAllRead(): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    await this.pushInbox(this.currentScope());
  }

  // Put a notification off (#309). Only one that CAME FROM a schedule can be
  // snoozed — the schedule is what holds the future moment — so the action
  // carries the id to move, and the scheduler is reached through its
  // capability rather than an import. `false` means there was nothing to move,
  // which is what the UI needs to say instead of pretending.
  async snooze(id: string, minutes: number): Promise<boolean> {
    const row = await this.prisma.notification.findFirst({ where: { id } });
    if (!row) return false;
    const action = parseNotificationActions(row.actionsJson).find(
      (entry) => entry.kind === 'snooze',
    );
    const scheduleId =
      action?.kind === 'snooze' ? action.scheduleId : undefined;
    if (!scheduleId) return false;
    const scheduler =
      this.capabilities.getCapability<ScheduleCapability>(SCHEDULE_CAPABILITY);
    if (!scheduler) return false;
    if (!(await scheduler.snooze(scheduleId, minutes))) return false;
    // Snoozing IS dealing with it for now: the row goes quiet and the schedule
    // brings it back. Leaving it unread would leave a badge for something the
    // person has explicitly postponed.
    await this.markRead(id);
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { id } });
    await this.pushInbox(this.currentScope());
  }

  // ── Channels a person uses at all (#311) ──────────────────────────────────

  // The master switch, separate from the per-type matrix: "I do not use this
  // channel" is a different statement from "this notification does not go
  // there", and conflating them would make switching a channel off mean
  // rewriting every row of the matrix.
  async channelEnabled(
    scopeId: string | null,
    channelId: string,
  ): Promise<boolean> {
    const row = await this.prisma.notifyChannelPref.findFirst({
      where: { scopeId, channelId },
    });
    // Absent means on: a channel somebody just connected should carry things
    // without asking for a second decision.
    return row?.enabled ?? true;
  }

  async setChannelEnabled(channelId: string, enabled: boolean): Promise<void> {
    const scopeId = this.currentScope();
    const existing = await this.prisma.notifyChannelPref.findFirst({
      where: { scopeId, channelId },
    });
    if (existing) {
      await this.prisma.notifyChannelPref.update({
        where: { id: existing.id },
        data: { enabled },
      });
      return;
    }
    await this.prisma.notifyChannelPref.create({
      data: { id: generateUuid(), scopeId, channelId, enabled },
    });
  }

  // ── Routing (#311) ────────────────────────────────────────────────────────

  async listRoutes(): Promise<
    { type: string; channelId: string; enabled: boolean }[]
  > {
    const rows = await this.prisma.notificationRoute.findMany();
    return rows.map((row) => ({
      type: row.type,
      channelId: row.channelId,
      enabled: row.enabled,
    }));
  }

  // Every cell of one row of the matrix, in one write: "Все" and "Никакие" in
  // the UI are one decision, and sending a request per channel would let it
  // land half-applied.
  async setRoutes(
    types: string[],
    channelIds: string[],
    enabled: boolean,
  ): Promise<void> {
    for (const type of types) {
      for (const channelId of channelIds) {
        await this.setRoute(type, channelId, enabled);
      }
    }
  }

  // A cell of the matrix. Absent means "the type's default", which is on, so
  // only a deliberate choice is ever written down.
  async setRoute(
    type: string,
    channelId: string,
    enabled: boolean,
  ): Promise<void> {
    const scopeId = this.currentScope();
    const existing = await this.prisma.notificationRoute.findFirst({
      where: { scopeId, type, channelId },
    });
    if (existing) {
      await this.prisma.notificationRoute.update({
        where: { id: existing.id },
        data: { enabled },
      });
      return;
    }
    await this.prisma.notificationRoute.create({
      data: { id: generateUuid(), scopeId, type, channelId, enabled },
    });
  }

  // The delivery log — what answers "why did nothing reach my phone".
  async listDeliveries(): Promise<
    {
      id: string;
      channelId: string;
      attempts: number;
      deliveredAt: string | null;
      deadAt: string | null;
      lastError: string | null;
    }[]
  > {
    const rows = await this.prisma.notificationDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channelId,
      attempts: row.attempts,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      deadAt: row.deadAt?.toISOString() ?? null,
      lastError: row.lastError,
    }));
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  async getPreferences(): Promise<NotifyPreferences> {
    const scopeId = this.currentScope();
    const row = await this.prisma.notifyPreference.findFirst({
      where: { scopeId },
    });
    return {
      quietFromMinutes: row?.quietFromMinutes ?? null,
      quietToMinutes: row?.quietToMinutes ?? null,
      timezone: row?.timezone ?? null,
      locale: row?.locale ?? null,
    };
  }

  async setPreferences(prefs: NotifyPreferences): Promise<NotifyPreferences> {
    const scopeId = this.currentScope();
    const existing = await this.prisma.notifyPreference.findFirst({
      where: { scopeId },
    });
    const data = {
      quietFromMinutes: prefs.quietFromMinutes,
      quietToMinutes: prefs.quietToMinutes,
      timezone: prefs.timezone,
      locale: prefs.locale,
    };
    if (existing) {
      // `update`, never `upsert`: the scope policy fails loud on an upsert
      // against a scoped model (§5.8).
      await this.prisma.notifyPreference.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.notifyPreference.create({
        data: { id: scopeId ?? SOLO_PREFERENCE_ID, scopeId, ...data },
      });
    }
    return this.getPreferences();
  }

  // Whether a channel should hold this recipient's notification back right now.
  // The inbox never asks — a row nobody was woken for is exactly what a quiet
  // window means — so this exists for the channels that land in #311.
  isQuietNow(prefs: NotifyPreferences, at: Date): boolean {
    const zone = prefs.timezone ?? undefined;
    const parts = new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: zone,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return isWithinQuietHours(prefs, hour * 60 + minute);
  }

  // ── Realtime ──────────────────────────────────────────────────────────────

  // Counting runs in the RECIPIENT's scope: the access policy would otherwise
  // confine the count to whoever happened to post, which for a fan-out is
  // somebody else entirely and reads as zero.
  private async pushInbox(scopeId: string | null): Promise<void> {
    const payload =
      scopeId === null
        ? await this.unreadCounts(null)
        : await this.context.runWithScope(scopeId, () =>
            this.unreadCounts(scopeId),
          );
    this.realtime.emitToRoom(
      notifyInboxRoom(scopeId),
      NOTIFY_INBOX_CHANGED_EVENT,
      payload,
    );
  }

  private toView(row: Prisma.NotificationGetPayload<object>): NotificationView {
    return {
      id: row.id,
      type: row.type,
      pluginId: row.pluginId,
      titleKey: row.titleKey,
      bodyKey: row.bodyKey ?? undefined,
      params: parseNotificationParams(row.paramsJson),
      ref: row.ref ?? undefined,
      importance: isImportance(row.importance) ? row.importance : 'normal',
      actions: parseNotificationActions(row.actionsJson),
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString(),
      occurrences: row.occurrences,
    };
  }
}
