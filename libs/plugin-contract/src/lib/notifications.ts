// The notification bus (#307) — the one path from a plugin to a PERSON.
//
// Deliberately not the domain-event bus. A domain event (see
// `external/external-events.ts`, `capabilities.ts`) is machine-to-machine: its
// recipient is a plugin, it carries a ref and the names of changed fields and
// never their values, and nothing about it says who should be told. A
// notification is the other half: it names an audience, it has read state, and
// it is rendered for a human. A plugin that wants to react to a fact listens to
// an event; a plugin that wants to SAY something posts here.
//
// What an emitter posts is a fact, never prose: keys and parameters, resolved
// per recipient. The recipient's locale is not knowable at emit time (the
// person being told is rarely the person acting), and the same notification has
// to render as an in-app row with a live `mk://` link, as a Telegram message
// with buttons, and — later — as an SMS with neither.

// How loudly a notification asks to be heard. The bus stores it; channels and
// quiet hours act on it (#311).
export type NotificationImportance = 'low' | 'normal' | 'high';

export const NOTIFICATION_IMPORTANCES: readonly NotificationImportance[] = [
  'low',
  'normal',
  'high',
];

// Who should be told. A discriminated union rather than a bag of optional ids:
// an emitter knows exactly one of these things, and `logistics` must be able to
// speak without knowing what a user is.
export type NotificationTarget =
  // The people who can see a scope. `owner` is the scope's owner alone,
  // `scope` everyone with access to it, `admins` the instance's administrators
  // (the only form that ignores `scopeId`). With the multiuser overlay off all
  // three collapse to the single user.
  | {
      kind: 'audience';
      scopeId?: string | null;
      audience: NotificationAudience;
    }
  // One named person. Used where the emitter genuinely knows the recipient —
  // an agent answering someone, a reminder its creator set for themselves.
  | { kind: 'user'; userId: string }
  // Everyone subscribed to a named topic within a scope. The bus resolves the
  // subscriber list; an emitter that publishes to a topic knows no names.
  | { kind: 'topic'; topic: string; scopeId?: string | null };

export type NotificationAudience = 'scope' | 'owner' | 'admins';

// What a person can do about a notification, declared rather than rendered: the
// in-app panel draws buttons, a chat channel draws inline keys, SMS draws
// nothing at all, and none of them needs to know what the action means.
export type NotificationAction =
  // Go to the object the notification is about (its `ref`).
  | { kind: 'open'; labelKey?: string }
  // Put it off. Only a notification that CAME FROM a schedule can be snoozed —
  // there is otherwise nothing holding the future moment — so the action names
  // the schedule to move. The bus reaches the scheduler through its capability,
  // never an import (#309).
  | { kind: 'snooze'; scheduleId?: string; labelKey?: string }
  // Drop it without going anywhere.
  | { kind: 'dismiss'; labelKey?: string }
  // Run a named hook of the declaring plugin. Carries the hook's permission
  // level so a channel can refuse to offer outside the app what may not be
  // confirmed there (#311): DESTRUCTIVE never leaves the app.
  | {
      kind: 'hook';
      hookId: string;
      labelKey: string;
      params?: Record<string, string | number | boolean>;
    };

// Reading the two JSON columns back. They live here, next to the union they
// decode, because the shape IS the contract: adding a fifth action kind should
// be one edit to the union and its guard, not a hunt through every service that
// happens to read the column.
//
// Stored JSON is `unknown` on the way back in, so both parse through guards
// rather than assertions (§5.1), and both are total: a column written by an
// older version, or by hand, degrades to "no actions" / "no params" instead of
// throwing inside whatever was rendering a notification.
export const isNotificationAction = (
  value: unknown,
): value is NotificationAction => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('kind' in value)) return false;
  const { kind } = value;
  return (
    kind === 'open' ||
    kind === 'snooze' ||
    kind === 'dismiss' ||
    kind === 'hook'
  );
};

export const parseNotificationActions = (
  raw: string | null,
): NotificationAction[] => {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isNotificationAction) : [];
  } catch {
    return [];
  }
};

// `undefined` for "nothing stored", so a caller that wants an empty record can
// say `?? {}` and one that distinguishes absent from empty still can.
export const parseNotificationParams = (
  raw: string | null,
): Record<string, string | number> | undefined => {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const out: Record<string, string | number> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string' || typeof entry === 'number') {
        out[key] = entry;
      }
    }
    return out;
  } catch {
    return undefined;
  }
};

// One notification, as its emitter states it.
export interface NotificationInput {
  // Registered type id, namespaced by its owner: `<pluginId>.<what-happened>`.
  // The type is what a person configures; the individual notification is not.
  type: string;
  target: NotificationTarget;
  // i18n keys in the EMITTING plugin's own bundle, resolved per recipient by
  // whatever renders the notification (§5.5).
  titleKey: string;
  bodyKey?: string;
  params?: Record<string, string | number>;
  // Canonical `mk://` ref of the subject, when there is one (§5.9).
  ref?: string;
  // Overrides the type's registered default. Omitted ⇒ the type decides.
  importance?: NotificationImportance;
  // Repeats with the same key update the unread notification instead of
  // stacking beside it — the update check polls on a schedule and must not
  // produce one row per poll. Scoped to the recipient, like everything else.
  dedupKey?: string;
  actions?: NotificationAction[];
}

// What a plugin declares once, in `onModuleInit()`, for each kind of thing it
// may tell someone. The declaration is what the settings matrix lists and what
// the person configures; the per-type configuration is seeded from it on FIRST
// registration only and never rewritten afterwards — the same rule agent tools
// follow for their confirmation policy (§5.7), and for the same reason: a
// redeploy must not silently undo somebody's choice.
export interface NotificationTypeDeclaration {
  type: string;
  // i18n key naming the type in the settings matrix.
  labelKey: string;
  defaultImportance?: NotificationImportance;
  // Channel ids this type may ever use. Omitted ⇒ every channel is allowed.
  // A type that is meaningless outside the app (a transient hint) names `[]`.
  allowedChannels?: string[];
}

// The bus itself, offered as a capability so an emitter degrades cleanly when
// `notify` is disabled: `getCapability` answers null and the emitter carries on
// (§5.10). Nothing in the shape assumes a table — an implementation is free to
// hand the work to a broker.
export const NOTIFY_BUS_CAPABILITY = 'notify.bus';

export interface NotifyBusCapability {
  // Post one notification. Resolves once it is stored for every recipient;
  // delivery to channels happens on the bus's own clock.
  post(input: NotificationInput): Promise<void>;
  // Declare the types this plugin may post. Idempotent; safe to call on every
  // boot (that is when it is called).
  declareTypes(pluginId: string, types: NotificationTypeDeclaration[]): void;
  // Offer something a notification's button may do. The bus authorises the
  // press with a single-use token and enforces the level before running it.
  registerActionHook(
    pluginId: string,
    hook: NotificationActionHook,
    handler: NotificationActionHandler,
  ): void;
}

// ── Channels (#311) ─────────────────────────────────────────────────────────

// One way of putting a notification in front of a person somewhere other than
// this app. Registered per channel under a shared prefix, so the bus can ask
// every installed one without knowing their names in advance.
export const NOTIFY_CHANNEL_PREFIX = 'notify-channel.';

export const notifyChannelCapability = (channelId: string): string =>
  `${NOTIFY_CHANNEL_PREFIX}${channelId}`;

// A notification as a channel receives it: already rendered, in the recipient's
// own language, with its actions already authorised. A channel formats and
// sends; it decides nothing about who hears what.
export interface RenderedNotification {
  notificationId: string;
  recipientUserId: string | null;
  title: string;
  body?: string;
  // Absolute in-app URL of the subject, when the notification names one.
  url?: string;
  importance: NotificationImportance;
  actions: RenderedNotificationAction[];
}

export interface RenderedNotificationAction {
  kind: NotificationAction['kind'];
  label: string;
  // Single use, short-lived, bound to this notification, this action, this
  // recipient and this channel. It authorises exactly one act and nothing else
  // — pressing a button in a chat client must not become a way into the API.
  token: string;
}

export interface NotifyChannelCapability {
  channelId: string;
  labelKey: string;
  // Whether this person has connected the channel at all. A notification is
  // never queued for a channel nobody linked — that is how a delivery log fills
  // with failures for something that was never going to work.
  isLinked(userId: string | null): Promise<boolean>;
  // Send it. THROWING is how a channel reports failure: the bus retries with
  // backoff and eventually marks the delivery dead, visibly.
  deliver(message: RenderedNotification): Promise<void>;
}

// A named thing a notification's button can do, offered by the plugin that owns
// the act. The level is enforced where the button is pressed: DESTRUCTIVE never
// leaves the app, whatever a channel renders.
export interface NotificationActionHook {
  hookId: string;
  labelKey: string;
  level: NotificationActionLevel;
}

// Mirrors the agent tool tiers (§5.7) without importing the enum into the
// browser bundle: the string values are identical.
export type NotificationActionLevel = 'READ' | 'WRITE' | 'DESTRUCTIVE';

export type NotificationActionHandler = (context: {
  notificationId: string;
  recipientUserId: string | null;
  params: Record<string, string | number | boolean>;
}) => Promise<void>;

// Realtime (#61): the room a person's own inbox changes are pushed to, and the
// event the shell listens for. The payload carries the new unread count and the
// plugin that caused the change, so the bell and the sidebar badge both update
// without refetching.
export const NOTIFY_ROOM_PREFIX = 'notify';

export function notifyInboxRoom(userId: string | null): string {
  // A single-user instance has exactly one inbox and no user id to name it by.
  return `${NOTIFY_ROOM_PREFIX}:${userId ?? 'solo'}`;
}

export const NOTIFY_INBOX_CHANGED_EVENT = 'notify.inbox-changed';

export interface NotifyInboxChangedPayload {
  unread: number;
  // Unread counts per emitting plugin id — what the sidebar badges show.
  unreadByPlugin: Record<string, number>;
}

// One row as the inbox hands it to a client. `titleKey`/`bodyKey` + `params`
// stay unresolved: the browser resolves them with `$t()` in the reader's own
// locale, exactly like every other string in the app.
export interface NotificationView {
  id: string;
  type: string;
  pluginId: string;
  titleKey: string;
  bodyKey?: string;
  params?: Record<string, string | number>;
  ref?: string;
  importance: NotificationImportance;
  actions: NotificationAction[];
  createdAt: string;
  readAt?: string;
  // How many times a deduplicated notification has repeated (1 = once).
  occurrences: number;
}

// Quiet hours, per person. Stored as minutes from local midnight so the pair
// survives a timezone the person changes later; `from === to` means no window.
// The bus stores and serves this; channels honour it (#311) — the inbox never
// does, since a row nobody was woken for is exactly what a quiet window means.
export interface NotifyPreferences {
  quietFromMinutes: number | null;
  quietToMinutes: number | null;
  timezone: string | null;
  // The language a channel message is built in. Written by the browser, since
  // nothing else knows it: the app has no server-side language store (#211).
  locale: string | null;
}

export const MINUTES_IN_DAY = 24 * 60;

// Whether `at` falls inside the quiet window, honouring a window that wraps
// past midnight (22:00–07:00 is the normal case, not the exotic one).
export function isWithinQuietHours(
  prefs: NotifyPreferences,
  minutesOfDay: number,
): boolean {
  const { quietFromMinutes: from, quietToMinutes: to } = prefs;
  if (from === null || to === null || from === to) return false;
  return from < to
    ? minutesOfDay >= from && minutesOfDay < to
    : minutesOfDay >= from || minutesOfDay < to;
}
