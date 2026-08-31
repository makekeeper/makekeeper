import { PermissionLevel } from './agent-types';
import type { NotificationInput } from './notifications';

// The scheduler (#308) — the seam that turns a MOMENT into an action.
//
// Kept apart from the notification bus on purpose: a notification is one-shot,
// addressed and dead once read, while a schedule repeats, survives its own
// firing and is edited. Sharing one record would give it a `dueAt` meaning
// either "when to tell somebody" or "when it last fired", and recurrence would
// have to be imitated with copies.

// What a schedule does when its moment arrives. A hook is named, not passed:
// the schedule row outlives the process that created it, so it can only store
// something re-resolvable.
export interface ScheduleHookDeclaration {
  // Namespaced by its owner: `<pluginId>.<hook>`.
  hookId: string;
  labelKey: string;
  // Classified exactly as an agent tool is (§5.7), and enforced the same way:
  // WRITE asks the person when the SCHEDULE is created (the one moment there
  // is a person to ask), and DESTRUCTIVE may not be scheduled at all.
  level: PermissionLevel;
  // What to do about firings missed while the app was down. `collapse` runs
  // once, told how many it stands for; `skip` runs not at all. Anything that
  // writes data declares `skip`: a workshop box off for a week must not wake
  // up and place seven orders.
  misfire: ScheduleMisfirePolicy;
}

export type ScheduleMisfirePolicy = 'collapse' | 'skip';

// How long after its due moment a missed firing is still worth running. Beyond
// this the fact has gone stale — a reminder about yesterday morning is noise,
// not a reminder — so it is recorded as missed and skipped.
export const DEFAULT_MISFIRE_GRACE_MINUTES = 24 * 60;

// One run of a hook, as the scheduler hands it over.
export interface ScheduleHookContext {
  scheduleId: string;
  // Scope the schedule belongs to; null on a single-user instance.
  scopeId: string | null;
  // The person who created it — who a `notify` hook tells, and who a WRITE
  // hook acts as.
  ownerUserId: string | null;
  // The moment this run was DUE, which is not the moment it ran.
  dueAt: Date;
  // How many due moments this run stands for (1 normally; more after downtime,
  // and only for a `collapse` hook).
  occurrences: number;
  // Whatever the schedule stored for its hook — the notification to post, the
  // tool arguments to use.
  params: Record<string, string | number | boolean>;
  // The object the schedule is about, when it names one.
  ref?: string;
}

export type ScheduleHookHandler = (
  context: ScheduleHookContext,
) => Promise<void>;

// When a schedule fires.
export type ScheduleTrigger =
  // A recurrence rule read in a named zone. "Monday at 10:00" is meaningless
  // without the zone, and a UTC-only instant drifts by an hour twice a year.
  | { kind: 'absolute'; rrule: string; timezone: string }
  // Relative to a date owned by another plugin: an hour before a task is due,
  // a day after an order was promised. The current value is asked of that
  // plugin's CalendarSource on every tick, so a moved deadline is followed and
  // a deleted object simply stops being due — with no event to emit and none
  // to forget.
  | {
      kind: 'relative';
      ref: string;
      field: string;
      offsetMinutes: number;
    };

export interface ScheduleInput {
  hookId: string;
  trigger: ScheduleTrigger;
  // Shown wherever the schedule is listed. Plain TEXT, not a key: it is what a
  // person typed, and user data has no translation (the same inversion nav
  // children make).
  title: string;
  params?: Record<string, string | number | boolean>;
  ref?: string;
  // A personal schedule is the creator's own; a shared one belongs to the
  // scope and is visible to everyone with access to it. They are separate
  // tables, so the overlay enforces the boundary instead of a query filter
  // that can be forgotten.
  //
  // Absent means PERSONAL. "Remind me" is the request people actually make,
  // and of the two mistakes only one is loud: a private reminder nobody else
  // sees can be shared later, while a private matter posted to everyone in the
  // workspace cannot be taken back.
  personal?: boolean;
}

export interface ScheduleView {
  id: string;
  hookId: string;
  title: string;
  trigger: ScheduleTrigger;
  params: Record<string, string | number | boolean>;
  ref?: string;
  personal: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  // Who set it. The id is null on an instance with no user accounts; the name
  // is null when nobody can resolve it (no overlay, or a user since removed),
  // and the screen then says so rather than printing an id at a person.
  createdByUserId?: string | null;
  createdByName?: string | null;
}

// The scheduler, offered as a capability: a plugin registers what it can do at
// a moment and asks for schedules to be made, without importing the scheduler
// (§5.10). `null` — absent or disabled — means the app simply cannot schedule,
// and a caller degrades instead of failing.
export const SCHEDULE_CAPABILITY = 'schedule.hooks';

export interface ScheduleCapability {
  registerHook(
    pluginId: string,
    declaration: ScheduleHookDeclaration,
    handler: ScheduleHookHandler,
  ): void;
  create(input: ScheduleInput): Promise<ScheduleView>;
  cancel(id: string): Promise<boolean>;
  // Move one schedule's next firing without touching its rule — what a
  // notification's "snooze" action does.
  snooze(id: string, minutes: number): Promise<boolean>;
}

// The notify plugin's own hook, so a schedule can simply tell somebody
// something. Declared here rather than in `notify` because both sides — the
// scheduler that stores the id and the reminder UI that offers it — need the
// same string, and neither may import the other.
export const NOTIFY_SCHEDULE_HOOK = 'notify.say';

// What `notify.say` expects in `params`: a notification minus its target,
// which the scheduler fills in from the schedule's owner.
export type ScheduledNotification = Pick<
  NotificationInput,
  'type' | 'titleKey' | 'bodyKey' | 'importance'
>;

// The clock itself, so it can be replaced (#308).
//
// The built-in engine is the database: a `nextRunAt` index and a minute tick,
// accurate to within a minute — ample for a reminder, restart-safe by
// construction (there are no in-memory timers to rebuild), and free of any
// third service. A broker is an option a plugin may supply, never a
// requirement of installing the product: one-click installs are app + web + a
// database, and something else to run and repair is a real cost to a person in
// a workshop.
export const SCHEDULE_TICK_ENGINE_CAPABILITY = 'schedule.tick-engine';

export interface ScheduleTickEngineCapability {
  // Take over the clock, given the sweep to run when something is due. `false`
  // means the engine cannot right now (its broker is unreachable), and the
  // built-in tick stays in charge rather than the app losing its clock.
  takeOver(runDue: () => Promise<void>): boolean;
}

// Anything dated a plugin owns (#310). Asked for a window when the calendar
// renders, and for one object when a relative trigger needs to know where its
// date is now — the same source answering both, so the calendar and the
// scheduler can never disagree about when something is.
export const calendarSourceCapability = (pluginId: string): string =>
  `calendar-source.${pluginId}`;

export interface CalendarItem {
  // Canonical mk:// ref of the object.
  ref: string;
  // i18n key naming what KIND of date this is ("due", "expected", "starts").
  // The object's own name is data and travels as `title`.
  kindKey: string;
  title: string;
  // The field this date came from, so a relative trigger can name it.
  field: string;
  at: string;
  // Set for something that occupies a stretch of time rather than a moment.
  endsAt?: string;
  // Already dealt with — a completed task, a delivered order. The calendar
  // renders it quietly instead of hiding it.
  done?: boolean;
}

export interface CalendarSourceCapability {
  itemsInRange(from: string, to: string): Promise<CalendarItem[]>;
  // The object's current date for that field, or null when the object is gone,
  // the field is empty, or the caller may not see it. A relative trigger reads
  // null as "not due", which is what makes a deleted object stop firing.
  dateOf(ref: string, field: string): Promise<string | null>;
}
