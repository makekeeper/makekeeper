// Opt-in liveness telemetry (#343, narrowing the deferred #102).
//
// It answers exactly one question — how many instances are still alive at 7 and
// at 30 days — because that number is what "a live user" means for the growth
// epic (#336) and nothing in the repository could answer it. Everything here is
// shaped by that single question: anything a survival curve does not need is not
// collected, and there is no second question this data could quietly grow to
// answer later.
//
// This module is THE source of what leaves an instance. The payload type, the
// field catalogue rendered on the consent screen, and the table in INSTALL.md
// all come from here, so the documentation cannot drift away from the code — a
// promise about what is sent is worthless if it lives in a paragraph nobody
// re-reads when the code changes.

/**
 * Where an instance stands on sending anything at all.
 *
 * `unasked` is not "no" waiting to be flipped — it is the state a fresh (and a
 * freshly updated) instance sits in, and it sends nothing, exactly like
 * `denied`. The distinction exists so the question can be put once, and so an
 * instance that was asked and closed the dialog is never asked again.
 */
export const TELEMETRY_CONSENTS = ['unasked', 'granted', 'denied'] as const;
export type TelemetryConsent = (typeof TELEMETRY_CONSENTS)[number];

export function isTelemetryConsent(value: unknown): value is TelemetryConsent {
  return TELEMETRY_CONSENTS.some((candidate) => candidate === value);
}

/** Exactly what a ping carries. Nothing else is ever added to the request. */
export interface TelemetryPayload {
  /**
   * A random identifier this instance made up for itself, stored in its own
   * database. It is what makes survival computable at all — without it a
   * hundred instances pinging once are indistinguishable from one instance
   * pinging a hundred times — and it is also what makes this data pseudonymous
   * rather than anonymous. It is tied to nothing else: not a domain, not an
   * account, not the content.
   */
  instanceId: string;
  /** The running release, e.g. "0.17.0". */
  version: string;
  /** How this instance was deployed (#100), or "unknown". */
  installMethod: string;
  /** Ids of the plugins enabled instance-wide, sorted. Never user data. */
  plugins: string[];
  /** The instance's default interface language, e.g. "en". */
  locale: string;
}

/**
 * The catalogue the consent screen renders and the documentation is checked
 * against. `labelKey`/`descriptionKey` are i18n keys in the SHELL's bundle,
 * resolved by whoever renders them (§5.5) — today the consent dialog and the
 * settings switch, both of which live in the frontend.
 *
 * Adding a field here is the ONLY way to add one to the payload, and doing so
 * makes the consent screen and INSTALL.md grow with it, or the guard fails.
 */
export interface TelemetryFieldSpec {
  key: keyof TelemetryPayload;
  labelKey: string;
  descriptionKey: string;
}

export const TELEMETRY_FIELDS: readonly TelemetryFieldSpec[] = [
  {
    key: 'instanceId',
    labelKey: 'telemetry.fields.instanceId.label',
    descriptionKey: 'telemetry.fields.instanceId.description',
  },
  {
    key: 'version',
    labelKey: 'telemetry.fields.version.label',
    descriptionKey: 'telemetry.fields.version.description',
  },
  {
    key: 'installMethod',
    labelKey: 'telemetry.fields.installMethod.label',
    descriptionKey: 'telemetry.fields.installMethod.description',
  },
  {
    key: 'plugins',
    labelKey: 'telemetry.fields.plugins.label',
    descriptionKey: 'telemetry.fields.plugins.description',
  },
  {
    key: 'locale',
    labelKey: 'telemetry.fields.locale.label',
    descriptionKey: 'telemetry.fields.locale.description',
  },
];

/** How often an instance that has agreed sends a ping. */
export const TELEMETRY_PING_INTERVAL_HOURS = 24;

/**
 * The outcome of the last attempt. A union rather than a bare string: the UI
 * branches on these values, and a comment listing them is not something a
 * compiler can check — the same reason `consent` has never been one.
 */
export const TELEMETRY_STATUSES = ['never', 'ok', 'unreachable'] as const;

export type TelemetryStatus = (typeof TELEMETRY_STATUSES)[number];

export function isTelemetryStatus(value: unknown): value is TelemetryStatus {
  return TELEMETRY_STATUSES.some((status): boolean => status === value);
}

/**
 * Stands in for the instance id in a preview shown before one exists. An id is
 * minted by the first "yes" and never by looking at the report, so the sender
 * and the block that renders it both need a value that means "not yet" — and
 * one definition of it, or the block stops recognising what the sender sends.
 */
export const TELEMETRY_PENDING_ID = '00000000-0000-0000-0000-000000000000';

/** What the settings surface and the consent dialog read. */
export interface TelemetryState {
  consent: TelemetryConsent;
  /** Null until consent is granted — the id is minted by the first "yes". */
  instanceId: string | null;
  /** Whether the question has been put to a human on this instance. */
  prompted: boolean;
  lastSentAt: string | null;
  lastStatus: TelemetryStatus;
  /**
   * Whether this build has somewhere to send to. A fork that blanks the
   * endpoint gets a UI that says so instead of a switch that does nothing.
   */
  endpointConfigured: boolean;
  /** The receiving address, shown verbatim so it is never a mystery. */
  endpoint: string | null;
}
