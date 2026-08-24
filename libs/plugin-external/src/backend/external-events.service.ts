import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PrismaService,
  RequestContextService,
  generateUuid,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_EVENT_SCHEMA_VERSION,
  ExternalWebhookEvent,
  PLUGIN_WEBHOOK_PATH,
  domainEventOwner,
} from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalPermissionsService } from './external-permissions.service';
import { readStoredStringArray } from './persisted';
import { ExternalScopeRefService } from './external-scope-ref.service';

// Core → plugin events (#136, decision #10).
//
// Why an outbox instead of a bare POST: inside the process a listener is
// either alive with the app or not at all, but an external plugin's "core is
// up, plugin is not" state is the NORMAL one — every deploy is a delivery
// window. Fire-and-forget would teach authors to poll instead, and we would
// end up with both webhooks and pollers. So deliveries are persisted, retried
// with backoff, and given up on visibly.
//
// The payload deliberately carries no record data: id, type, scope, ORef and
// the names of the changed fields — never their values. Details are fetched by
// the plugin through the API surfaces with its own token, so a subscription
// can never become a way around the permission matrix — and a value that
// might already be stale can never be mistaken for the truth.

const MAX_ATTEMPTS = 8;
const RETENTION_DAYS = 7;
// 30s, 1m, 2m, 4m, 8m, 16m, 32m, 64m — ~2h of catching up, which covers a
// deploy or a crash-loop without hammering a plugin that is simply gone.
const backoffMs = (attempt: number): number =>
  Math.min(30_000 * 2 ** (attempt - 1), 64 * 60_000);

@Injectable()
export class ExternalEventsService {
  private readonly logger = new Logger(ExternalEventsService.name);
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExternalRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
    private readonly permissions: ExternalPermissionsService,
  ) {}

  // Fan an event out to every ACTIVE plugin that subscribed to its type. Rows
  // are written per subscriber so each retries on its own clock.
  async publish(input: {
    type: string;
    scopeId?: string | null;
    ref?: string;
    changed?: string[];
  }): Promise<void> {
    // Domain events are gated by the owner's read grant — hearing is reading
    // (#189 decision 3); `core.*` lifecycle names have no owner and no gate.
    const owner = domainEventOwner(input.type);
    const eventScope = input.scopeId ?? null;
    const subscribers = (await this.registry.listActive()).filter((p) => {
      if (!(p.manifest.events ?? []).includes(input.type)) return false;
      if (owner && !this.permissions.canHearDomainEvent(owner, p.grants)) {
        return false;
      }
      // Scope rule (#189 decision 4): a per-scope plugin hears only its bound
      // scope, which also makes a scopeless event instance-subscribers-only.
      if (p.scopeId !== null && p.scopeId !== eventScope) return false;
      return true;
    });
    if (subscribers.length === 0) return;

    const eventId = generateUuid();
    const occurredAt = new Date();
    await this.context.runWithoutScope('stats-aggregation', async () => {
      await this.prisma.externalEventDelivery.createMany({
        data: subscribers.map((plugin) => ({
          id: generateUuid(),
          pluginId: plugin.pluginId,
          eventId,
          type: input.type,
          eventScopeId: input.scopeId ?? null,
          ref: input.ref ?? null,
          changedJson:
            input.changed && input.changed.length > 0
              ? JSON.stringify(input.changed)
              : null,
          occurredAt,
          nextAttemptAt: occurredAt,
        })),
      });
    });
    // Deliver promptly rather than waiting for the next tick; failures fall
    // back to the scheduled drain.
    void this.drain();
  }

  // The worker. Runs on a schedule AND right after a publish; `draining`
  // keeps the two from overlapping.
  @Cron(CronExpression.EVERY_30_SECONDS)
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = new Date();
      const due = await this.context.runWithoutScope(
        'stats-aggregation',
        async () =>
          this.prisma.externalEventDelivery.findMany({
            where: {
              deliveredAt: null,
              deadAt: null,
              nextAttemptAt: { lte: now },
            },
            orderBy: { occurredAt: 'asc' },
            take: 100,
          }),
      );
      for (const row of due) await this.deliver(row);
    } finally {
      this.draining = false;
    }
  }

  private async deliver(row: {
    id: string;
    pluginId: string;
    eventId: string;
    type: string;
    eventScopeId: string | null;
    ref: string | null;
    changedJson: string | null;
    occurredAt: Date;
    attempts: number;
  }): Promise<void> {
    const plugin = await this.registry.getActive(row.pluginId);
    // Disabled/uninstalled mid-flight, or the breaker is open: leave the row
    // due and try later — an unreachable plugin must not burn its retries on
    // calls the breaker would short-circuit anyway.
    if (!plugin)
      return this.reschedule(row.id, row.attempts, 'plugin-inactive');
    if (this.breaker.shouldSkip(row.pluginId)) return;

    // Re-check the grant the fan-out already checked: revoking a permission
    // must also stop events that were queued while it was held (#189 decision
    // 3). Dead-lettered, not deleted — silence would look like a lost event.
    const owner = domainEventOwner(row.type);
    if (owner && !this.permissions.canHearDomainEvent(owner, plugin.grants)) {
      await this.prisma.externalEventDelivery.update({
        where: { id: row.id },
        data: {
          deadAt: new Date(),
          lastError: 'grant-revoked',
          nextAttemptAt: null,
        },
      });
      return;
    }

    const payload: ExternalWebhookEvent = {
      eventId: row.eventId,
      type: row.type,
      schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
      // Opaque scope reference, never the internal id (decision #5).
      scopeId:
        (await this.scopeRefs.toRef(row.pluginId, row.eventScopeId)) ?? '',
      ref: row.ref ?? undefined,
      changed: row.changedJson
        ? readStoredStringArray(row.changedJson)
        : undefined,
      occurredAt: row.occurredAt.toISOString(),
    };
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_WEBHOOK_PATH,
      payload,
      this.breaker.budget('hook'),
    );
    if (res.ok) {
      this.breaker.recordSuccess(row.pluginId);
      await this.prisma.externalEventDelivery.update({
        where: { id: row.id },
        data: { deliveredAt: new Date(), attempts: row.attempts + 1 },
      });
      return;
    }
    this.breaker.recordFailure(row.pluginId);
    await this.reschedule(row.id, row.attempts, res.errorCode ?? 'error');
  }

  private async reschedule(
    id: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const next = attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      await this.prisma.externalEventDelivery.update({
        where: { id },
        data: {
          attempts: next,
          deadAt: new Date(),
          lastError: error,
          nextAttemptAt: null,
        },
      });
      this.logger.warn(
        `external event delivery gave up after ${next} attempts: ${id}`,
      );
      return;
    }
    await this.prisma.externalEventDelivery.update({
      where: { id },
      data: {
        attempts: next,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + backoffMs(next)),
      },
    });
  }

  // Admin view: what is stuck or dead for one plugin.
  async deadLetters(pluginId: string): Promise<
    Array<{
      id: string;
      type: string;
      attempts: number;
      lastError: string | null;
      occurredAt: string;
    }>
  > {
    const rows = await this.prisma.externalEventDelivery.findMany({
      where: { pluginId, deadAt: { not: null } },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      attempts: r.attempts,
      lastError: r.lastError,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }

  // Admin action: put a dead delivery back in the queue.
  async redeliver(id: string): Promise<void> {
    await this.prisma.externalEventDelivery.update({
      where: { id },
      data: {
        deadAt: null,
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    void this.drain();
  }

  // Retention: at-least-once holds within the window, not forever (decision
  // #10). Delivered rows go early; dead ones stay the full window so an admin
  // can still see them.
  @Cron(CronExpression.EVERY_HOUR)
  async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.context.runWithoutScope('stats-aggregation', async () => {
      await this.prisma.externalEventDelivery.deleteMany({
        where: {
          OR: [
            { deliveredAt: { not: null }, occurredAt: { lt: cutoff } },
            { deadAt: { not: null }, occurredAt: { lt: cutoff } },
          ],
        },
      });
    });
  }

  // Uninstall cleanup: a plugin's outbox dies with it (#133 leaves the row
  // deletion to the registry; this keeps deliveries from outliving it).
  async forgetPlugin(pluginId: string): Promise<void> {
    await this.prisma.externalEventDelivery.deleteMany({ where: { pluginId } });
  }
}
