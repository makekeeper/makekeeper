// Generic phone-connection bridge (#77). Framework-agnostic DTOs shared by the
// bridge backend, the frontend-core desktop primitive, and every consumer
// plugin's phone surface. Generalizes the original phone-capture flow (#6): the
// desktop opens a tokenized session declaring a `kind`; the phone opens
// `/d/<token>` over an optional Cloudflare tunnel; the bridge renders the
// surface registered for that kind; messages relay back to the desktop. No
// class-validator, no Vue — client and server share these shapes so they never
// drift (CLAUDE.md backend quality bar).

// Which phone experience a session opens. Open string — a consumer plugin
// declares its own (`capture` → 'capture', a future scanner → 'scan').
export type PhoneBridgeKind = string;

export type PhoneBridgeSessionStatus =
  | 'pending'
  | 'active'
  | 'closed'
  | 'expired';

// What the desktop is connecting the phone for. Encoded (as JSON) in the session
// so the phone shell can show a label and dispatch to the right surface.
export interface PhoneBridgeContext {
  kind: PhoneBridgeKind;
  // The specific target within the surface (e.g. a chat session id).
  targetId?: string;
  // Project scope, when the surface has one.
  projectId?: string;
  // Human-readable label shown on the phone ("Chat", "Task #12"). i18n-resolved
  // on the desktop before the session is created — the phone shows it verbatim.
  contextLabel?: string;
  // Optional surface-specific bootstrap data, opaque to the bridge.
  data?: unknown;
}

// Response to the desktop creating a session: everything needed to render the
// QR and start polling.
export interface CreatePhoneBridgeSessionResponse {
  token: string;
  // Absolute phone-facing URL encoded in the QR (https://<host>/d/<token>).
  // The QR itself is drawn by the client (#263): a server-rendered image cannot
  // follow the viewer's theme, and one shared generator beat three.
  url: string;
  expiresAt: string;
  // Seconds the client should wait (showing progress) before revealing the QR,
  // to let a freshly-started tunnel's DNS propagate so the phone doesn't cache a
  // failed lookup. 0 when the tunnel was already up (or no tunnel is used).
  warmupSeconds: number;
}

// Phone-side validation of a token before rendering the surface.
export interface PhoneBridgeSessionInfo {
  status: PhoneBridgeSessionStatus;
  kind: PhoneBridgeKind;
  expiresAt: string;
  contextLabel?: string;
  // The desktop's surface-specific bootstrap data (#79), relayed verbatim so the
  // phone surface can render what the host offers (e.g. the actions a scanned
  // code may trigger). Opaque to the bridge — the surface narrows it.
  data?: unknown;
}

// One relayed item, as seen by the desktop poller. `data` is surface-defined (a
// photo ref, a scanned string, …) — opaque to the bridge, narrowed by the
// consumer that registered the kind.
export interface PhoneBridgeMessage {
  id: string;
  createdAt: string;
  data: unknown;
}

// Cursor-based poll result. `cursor` is opaque; pass it back as `since` to get
// only newer messages.
export interface PhoneBridgeResultsResponse {
  status: PhoneBridgeSessionStatus;
  messages: PhoneBridgeMessage[];
  cursor: string;
}

// Phone → server relay envelope. `payload` is surface-defined (a photo data URL,
// a scanned string, …); the bridge forwards it verbatim to the kind handler.
export interface PhoneBridgeMessageInput {
  payload: unknown;
}

// --- Cloudflare tunnel management (bridge settings) ---

// off: never tunnel. on: keep a tunnel up. auto: bring one up on demand when a
// session needs a public URL, tear it down when idle.
export type TunnelMode = 'off' | 'on' | 'auto';

export type TunnelState =
  | 'disabled' // mode is off
  | 'stopped' // mode allows it, not currently running
  | 'starting'
  | 'running'
  | 'error';

// Live tunnel status shown in the settings panel.
export interface TunnelStatus {
  mode: TunnelMode;
  state: TunnelState;
  // Public URL while running.
  url?: string;
  // Human-readable detail (last error, or the resolved binary path).
  message?: string;
  // Whether the cloudflared binary was found (at the configured or default path).
  binaryPresent: boolean;
  // The binary path in effect (configured override, or the default lookup).
  binaryPath?: string;
  // Whether the auto-downloaded (managed) binary file exists — i.e. there is
  // something to delete. Optional so older payloads still parse.
  managedBinaryPresent?: boolean;
}

// The bridge plugin's persisted settings, as sent to the settings panel.
export interface PhoneBridgeSettingsPublic {
  tunnelMode: TunnelMode;
  cloudflaredPath: string | null;
  // Minutes to keep an `auto` tunnel up, measured from its last use. The tunnel
  // is stopped once it has been idle (no session activity) for this long.
  tunnelIdleTtlMinutes: number;
}

// --- Runtime type guards (CLAUDE.md §5.1) ---
// A network JSON body is a truly-dynamic value: parse it as `unknown` and narrow
// with these guards rather than casting the response to a type it might not have.
// This matters most for the phone-originated payloads relayed over the *public*
// `/d/:token` route — a leaked token lets an untrusted client shape that JSON, so
// the desktop must validate the envelope before rendering it. Surface-defined
// `data` stays `unknown` by design (the kind consumer narrows it downstream).

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const TUNNEL_MODES: readonly TunnelMode[] = ['off', 'on', 'auto'];
export const isTunnelMode = (value: unknown): value is TunnelMode =>
  typeof value === 'string' &&
  (TUNNEL_MODES as readonly string[]).includes(value);

const TUNNEL_STATES: readonly TunnelState[] = [
  'disabled',
  'stopped',
  'starting',
  'running',
  'error',
];
const isTunnelState = (value: unknown): value is TunnelState =>
  typeof value === 'string' &&
  (TUNNEL_STATES as readonly string[]).includes(value);

const SESSION_STATUSES: readonly PhoneBridgeSessionStatus[] = [
  'pending',
  'active',
  'closed',
  'expired',
];
export const isPhoneBridgeSessionStatus = (
  value: unknown,
): value is PhoneBridgeSessionStatus =>
  typeof value === 'string' &&
  (SESSION_STATUSES as readonly string[]).includes(value);

export const isPhoneBridgeMessage = (
  value: unknown,
): value is PhoneBridgeMessage =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.createdAt === 'string' &&
  'data' in value;

export const isPhoneBridgeSessionInfo = (
  value: unknown,
): value is PhoneBridgeSessionInfo =>
  isRecord(value) &&
  isPhoneBridgeSessionStatus(value.status) &&
  typeof value.kind === 'string' &&
  typeof value.expiresAt === 'string' &&
  isOptionalString(value.contextLabel);
// `data` is intentionally unchecked here: it is surface-defined and narrowed by
// the surface that consumes it (see `isPhoneBridgeScanSessionData`).

export const isCreatePhoneBridgeSessionResponse = (
  value: unknown,
): value is CreatePhoneBridgeSessionResponse =>
  isRecord(value) &&
  typeof value.token === 'string' &&
  typeof value.url === 'string' &&
  typeof value.expiresAt === 'string' &&
  typeof value.warmupSeconds === 'number';

export const isPhoneBridgeResultsResponse = (
  value: unknown,
): value is PhoneBridgeResultsResponse =>
  isRecord(value) &&
  isPhoneBridgeSessionStatus(value.status) &&
  typeof value.cursor === 'string' &&
  Array.isArray(value.messages) &&
  value.messages.every(isPhoneBridgeMessage);

export const isTunnelStatus = (value: unknown): value is TunnelStatus =>
  isRecord(value) &&
  isTunnelMode(value.mode) &&
  isTunnelState(value.state) &&
  typeof value.binaryPresent === 'boolean' &&
  isOptionalString(value.url) &&
  isOptionalString(value.message) &&
  isOptionalString(value.binaryPath);

export const isPhoneBridgeSettingsPublic = (
  value: unknown,
): value is PhoneBridgeSettingsPublic =>
  isRecord(value) &&
  isTunnelMode(value.tunnelMode) &&
  (value.cloudflaredPath === null ||
    typeof value.cloudflaredPath === 'string') &&
  typeof value.tunnelIdleTtlMinutes === 'number';
