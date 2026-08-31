import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  PrismaService,
  RequestContextService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  DEFAULT_MISFIRE_GRACE_MINUTES,
  PermissionLevel,
  SCOPE_DIRECTORY_CAPABILITY,
  calendarSourceCapability,
  parseObjectRef,
  type CalendarSourceCapability,
  type ScheduleHookDeclaration,
  type ScheduleHookHandler,
  type ScheduleInput,
  type ScheduleTrigger,
  type ScopeDirectoryCapability,
  type ScheduleView,
} from '@makekeeper/plugin-contract';
import {
  checkRecurrence,
  nextOccurrence,
  normalizeRule,
  occurrencesBetween,
} from './recurrence';

// A firing later than this after its due moment counts as MISSED rather than
// merely late: a minute tick is allowed to be a minute late.
const LATE_TOLERANCE_MS = 5 * 60_000;

interface RegisteredHook {
  pluginId: string;
  declaration: ScheduleHookDeclaration;
  handler: ScheduleHookHandler;
}

// The two tables read as one list. `personal` says which one a row came from —
// their id spaces are separate, so it travels with every id.
interface ScheduleRow {
  id: string;
  personal: boolean;
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

export class ScheduleRefused extends Error {
  constructor(readonly reasonKey: string) {
    super(reasonKey);
  }
}

const parseParams = (
  raw: string | null,
): Record<string, string | number | boolean> => {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {};
    }
    const out: Record<string, string | number | boolean> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean'
      ) {
        out[key] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
};

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private readonly hooks = new Map<string, RegisteredHook>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  // ── Hooks ─────────────────────────────────────────────────────────────────

  registerHook(
    pluginId: string,
    declaration: ScheduleHookDeclaration,
    handler: ScheduleHookHandler,
  ): void {
    this.hooks.set(declaration.hookId, { pluginId, declaration, handler });
  }

  listHooks(): RegisteredHook[] {
    return [...this.hooks.values()];
  }

  // ── Creating ──────────────────────────────────────────────────────────────

  async create(input: ScheduleInput): Promise<ScheduleView> {
    const hook = this.hooks.get(input.hookId);
    if (!hook) throw new ScheduleRefused('schedule.errors.unknownHook');
    // A schedule is an execution path with nobody in front of it, so the one
    // tier that must never run unattended cannot be scheduled at all — not
    // "asked about later", refused here (§5.7).
    if (hook.declaration.level === PermissionLevel.DESTRUCTIVE) {
      throw new ScheduleRefused('schedule.errors.destructiveHook');
    }
    // A rule that names its own zone is normalized before anything else looks
    // at it, so the record stores floating digits plus exactly one zone (#325).
    const trigger: ScheduleTrigger =
      input.trigger.kind === 'absolute'
        ? (() => {
            const clean = normalizeRule(
              input.trigger.rrule,
              input.trigger.timezone,
            );
            return {
              kind: 'absolute',
              rrule: clean.rule,
              timezone: clean.timezone,
            } satisfies ScheduleTrigger;
          })()
        : input.trigger;
    const normalized: ScheduleInput = { ...input, trigger };
    if (trigger.kind === 'absolute') {
      const check = checkRecurrence(trigger.rrule, trigger.timezone);
      // `ok: false` is the arm that carries the reason; narrowing keeps the
      // union honest instead of reaching into it.
      if (check.ok === false) throw new ScheduleRefused(check.reasonKey);
    }

    const context = this.context.get();
    const scopeId = context?.scopeId ?? null;
    const ownerUserId = context?.userId ?? null;
    const nextRunAt = await this.computeNext(trigger, new Date());
    // A rule with nothing left ahead of it produces a row that can never fire
    // and therefore appears nowhere: not on the calendar, not in the bell, not
    // in a list ordered by when things happen. Refused instead of stored, so
    // whoever asked — a person or a model — is told rather than left waiting
    // for a reminder that was dead on arrival (#318).
    //
    // Only for an absolute rule: a relative trigger with no date yet is parked
    // on purpose, and starts moving the moment the object gets one.
    if (trigger.kind === 'absolute' && nextRunAt === null) {
      throw new ScheduleRefused('schedule.errors.nothingAhead');
    }
    const data = {
      id: generateUuid(),
      scopeId,
      ownerUserId,
      hookId: normalized.hookId,
      title: normalized.title,
      triggerKind: trigger.kind,
      rrule: trigger.kind === 'absolute' ? trigger.rrule : null,
      timezone: trigger.kind === 'absolute' ? trigger.timezone : null,
      ref: trigger.kind === 'relative' ? trigger.ref : (normalized.ref ?? null),
      refField: trigger.kind === 'relative' ? trigger.field : null,
      offsetMinutes: trigger.kind === 'relative' ? trigger.offsetMinutes : null,
      paramsJson: normalized.params ? JSON.stringify(normalized.params) : null,
      nextRunAt,
    };
    // Absent means personal (§ScheduleInput): only an explicit `false` puts a
    // schedule in front of the whole scope.
    const personal = normalized.personal !== false;
    const row = personal
      ? await this.prisma.personalSchedule.create({ data })
      : await this.prisma.schedule.create({ data });
    return this.toView({ ...row, personal });
  }

  async list(): Promise<ScheduleView[]> {
    const [shared, personal] = await Promise.all([
      this.prisma.schedule.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.personalSchedule.findMany({ orderBy: { createdAt: 'desc' } }),
    ]);
    const views = [
      ...shared.map((row) => this.toView({ ...row, personal: false })),
      ...personal.map((row) => this.toView({ ...row, personal: true })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return this.withCreatorNames(views);
  }

  // One schedule, for a screen showing what a single entry actually is (#322).
  async find(id: string): Promise<ScheduleView | null> {
    const row = await this.findRow(id);
    if (!row) return null;
    const [view] = await this.withCreatorNames([this.toView(row)]);
    return view;
  }

  // Ids are what the rows store; a person needs a name. Resolved in one batch
  // through the overlay's directory — with no overlay there is no capability
  // and no names, which is the truth on a single-user instance rather than a
  // gap to paper over.
  private async withCreatorNames(
    views: ScheduleView[],
  ): Promise<ScheduleView[]> {
    const ids = views
      .map((view) => view.createdByUserId)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return views;
    const directory = this.capabilities.getCapability<ScopeDirectoryCapability>(
      SCOPE_DIRECTORY_CAPABILITY,
    );
    if (!directory) return views;
    const names = await directory.displayNames(ids);
    return views.map((view) => ({
      ...view,
      createdByName: view.createdByUserId
        ? (names[view.createdByUserId] ?? null)
        : null,
    }));
  }

  // Ids of the two tables are separate spaces, so a lookup asks both. The
  // access policy is what decides whether the caller may see either.
  private async findRow(id: string): Promise<ScheduleRow | null> {
    const shared = await this.prisma.schedule.findFirst({ where: { id } });
    if (shared) return { ...shared, personal: false };
    const personal = await this.prisma.personalSchedule.findFirst({
      where: { id },
    });
    return personal ? { ...personal, personal: true } : null;
  }

  async cancel(id: string): Promise<boolean> {
    const row = await this.findRow(id);
    if (!row) return false;
    if (row.personal) {
      await this.prisma.personalSchedule.deleteMany({ where: { id } });
    } else {
      await this.prisma.schedule.deleteMany({ where: { id } });
    }
    return true;
  }

  // Push the next firing back without touching the rule — what "snooze" on a
  // notification does. The rule itself is untouched, so a recurring schedule
  // returns to its own rhythm on the following firing.
  async snooze(id: string, minutes: number): Promise<boolean> {
    const row = await this.findRow(id);
    if (!row) return false;
    const next = new Date(Date.now() + minutes * 60_000);
    await this.updateRow(row, { nextRunAt: next });
    return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const row = await this.findRow(id);
    if (!row) return false;
    // Re-enabling recomputes from NOW, so a schedule switched back on does not
    // arrive owing every firing it slept through.
    const nextRunAt = enabled
      ? await this.computeNext(this.triggerOf(row), new Date())
      : row.nextRunAt;
    await this.updateRow(row, { enabled, nextRunAt });
    return true;
  }

  private async updateRow(
    row: ScheduleRow,
    data: { enabled?: boolean; nextRunAt?: Date | null; lastRunAt?: Date },
  ): Promise<void> {
    if (row.personal) {
      await this.prisma.personalSchedule.updateMany({
        where: { id: row.id },
        data,
      });
    } else {
      await this.prisma.schedule.updateMany({ where: { id: row.id }, data });
    }
  }

  // ── When a schedule is next due ───────────────────────────────────────────

  private triggerOf(row: ScheduleRow): ScheduleTrigger {
    if (row.triggerKind === 'relative' && row.ref && row.refField) {
      return {
        kind: 'relative',
        ref: row.ref,
        field: row.refField,
        offsetMinutes: row.offsetMinutes ?? 0,
      };
    }
    return {
      kind: 'absolute',
      rrule: row.rrule ?? '',
      timezone: row.timezone ?? 'UTC',
    };
  }

  // A relative trigger asks the OWNING plugin's calendar source every time,
  // rather than subscribing to a change event. That is what makes a moved
  // deadline followed, a deleted object stop firing, and a plugin that forgot
  // to announce something impossible — there is nothing to announce.
  async computeNext(
    trigger: ScheduleTrigger,
    after: Date,
  ): Promise<Date | null> {
    if (trigger.kind === 'absolute') {
      return nextOccurrence(trigger.rrule, trigger.timezone, after);
    }
    const parsed = parseObjectRef(trigger.ref);
    if (!parsed) return null;
    const source = this.capabilities.getCapability<CalendarSourceCapability>(
      calendarSourceCapability(parsed.pluginId),
    );
    if (!source) return null;
    const at = await source.dateOf(trigger.ref, trigger.field);
    if (!at) return null;
    const due = new Date(
      new Date(at).getTime() + trigger.offsetMinutes * 60_000,
    );
    // Already past: not due again. A one-off relative reminder is finished
    // once its object's date has gone by.
    return due.getTime() > after.getTime() ? due : null;
  }

  // ── The tick ──────────────────────────────────────────────────────────────

  // Every schedule whose moment has come, across every scope. Reads with the
  // policy suspended — a background job belongs to nobody — and each row is
  // then RUN inside its own owner's scope.
  async due(now: Date): Promise<ScheduleRow[]> {
    return this.context.runWithoutScope('scheduler-tick', async () => {
      const where = { enabled: true, nextRunAt: { lte: now } };
      const [shared, personal] = await Promise.all([
        this.prisma.schedule.findMany({ where }),
        this.prisma.personalSchedule.findMany({ where }),
      ]);
      return [
        ...shared.map((row) => ({ ...row, personal: false })),
        ...personal.map((row) => ({ ...row, personal: true })),
      ];
    });
  }

  async runDue(now: Date): Promise<void> {
    for (const row of await this.due(now)) {
      try {
        await this.runOne(row, now);
      } catch (err) {
        this.logger.error(`Schedule ${row.id} failed: ${getErrorMessage(err)}`);
      }
    }
  }

  private async runOne(row: ScheduleRow, now: Date): Promise<void> {
    const hook = this.hooks.get(row.hookId);
    const dueAt = row.nextRunAt ?? now;
    const trigger = this.triggerOf(row);
    const nextRunAt = await this.computeNext(trigger, now);

    // Claim the firing before running it, by moving the clock only if it is
    // still where this sweep found it. One process guards itself with a flag;
    // TWO — a redeploy overlapping its predecessor, a stray dev instance — do
    // not, and the cost of that is somebody's reminder arriving twice. The
    // compare-and-set makes the second claimant lose, whoever is running it.
    if (!(await this.claim(row, dueAt, nextRunAt))) return;

    if (!hook) {
      // The owning plugin is gone or disabled. The row stays and its clock
      // keeps moving, so re-enabling the plugin resumes the schedule instead of
      // replaying everything it slept through.
      await this.finish(row, dueAt, 'skipped', 'schedule.run.noHook');
      return;
    }

    const lateBy = now.getTime() - dueAt.getTime();
    const missed = lateBy > LATE_TOLERANCE_MS;
    const graceMs = DEFAULT_MISFIRE_GRACE_MINUTES * 60_000;

    if (missed && (hook.declaration.misfire === 'skip' || lateBy > graceMs)) {
      // Either the hook writes data — and a box that was off for a week must
      // not wake up and place seven orders — or the fact has gone stale.
      await this.finish(
        row,
        dueAt,
        'skipped',
        hook.declaration.misfire === 'skip'
          ? 'schedule.run.missedWrite'
          : 'schedule.run.tooLate',
      );
      return;
    }

    // How many due moments this one run stands for. Collapsed into a single
    // firing that says how many: seven identical reminders on a Monday morning
    // are worse than one that says it is a week overdue.
    const occurrences =
      missed && trigger.kind === 'absolute'
        ? Math.max(
            1,
            occurrencesBetween(trigger.rrule, trigger.timezone, dueAt, now)
              .length,
          )
        : 1;

    const run = async (): Promise<void> => {
      await hook.handler({
        scheduleId: row.id,
        scopeId: row.scopeId,
        ownerUserId: row.ownerUserId,
        dueAt,
        occurrences,
        params: parseParams(row.paramsJson),
        ref: row.ref ?? undefined,
      });
    };

    try {
      // The hook runs as the schedule's owner, so whatever it reads and writes
      // is scoped exactly as if that person had asked for it.
      if (row.ownerUserId) {
        await this.context.runWithScope(row.ownerUserId, run);
      } else {
        await run();
      }
      await this.finish(row, dueAt, 'ok', null, occurrences);
    } catch (err) {
      await this.finish(row, dueAt, 'error', getErrorMessage(err), occurrences);
    }
  }

  // Atomically move a schedule's clock, but only from the moment this sweep
  // read. `updateMany` reports how many rows matched, which is the whole of the
  // mechanism: 1 means we own this firing, 0 means somebody else already did.
  private async claim(
    row: ScheduleRow,
    dueAt: Date,
    nextRunAt: Date | null,
  ): Promise<boolean> {
    return this.context.runWithoutScope('scheduler-tick', async () => {
      const data = { nextRunAt, lastRunAt: new Date() };
      const where = { id: row.id, nextRunAt: dueAt };
      const result = row.personal
        ? await this.prisma.personalSchedule.updateMany({ where, data })
        : await this.prisma.schedule.updateMany({ where, data });
      return result.count === 1;
    });
  }

  private async finish(
    row: ScheduleRow,
    dueAt: Date,
    outcome: 'ok' | 'error' | 'skipped',
    detail: string | null,
    occurrences = 1,
  ): Promise<void> {
    await this.context.runWithoutScope('scheduler-tick', async () => {
      // The clock was already moved by `claim`, before the hook ran; recording
      // what happened is all that is left.
      await this.prisma.scheduleRun.create({
        data: {
          id: generateUuid(),
          scopeId: row.ownerUserId ?? row.scopeId,
          scheduleId: row.id,
          personal: row.personal,
          hookId: row.hookId,
          dueAt,
          occurrences,
          outcome,
          detail,
        },
      });
    });
  }

  private toView(row: ScheduleRow): ScheduleView {
    return {
      id: row.id,
      hookId: row.hookId,
      title: row.title,
      trigger: this.triggerOf(row),
      params: parseParams(row.paramsJson),
      ref: row.ref ?? undefined,
      personal: row.personal,
      enabled: row.enabled,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdByUserId: row.ownerUserId ?? null,
      createdByName: null,
    };
  }
}
