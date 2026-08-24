// Shared realtime (socket.io) contract (#61), touched by the NestJS gateway in
// backend-core and the socket singleton in frontend-core. Declared here so
// client and server never drift: room grammar, event names and payload shapes
// live in ONE place. Framework-agnostic: no socket.io imports, plain types.
//
// Design: realtime carries two kinds of traffic. For CAPTURE it is a
// *progress/nudge* channel — the cursor-based poll stays authoritative and a
// lost event degrades to polling. For CHAT the socket is the transport: an
// agent turn runs as a client→server command and its stages + final reply come
// back over the session room (chat is a core, always-enabled plugin, so it may
// depend on the socket being present).

import { PermissionLevel } from './agent-types';
import type { ScopeAccess } from './multiuser';
import type { ModelConstraintMap } from './scope-restriction';

// Socket.io endpoint path. Lives under /api so the existing nginx `/api/`
// proxy (which already forwards Upgrade/Connection headers) carries the
// WebSocket without any new routing rule.
export const REALTIME_PATH = '/api/socket.io';

// ── Rooms ───────────────────────────────────────────────────────────────────
// Grammar: `<prefix>:<id>`. The prefix routes a client subscribe request to
// the authorizer its owning plugin registered with RealtimeService; a room
// whose prefix has no registered authorizer is denied.

export const phoneBridgeRoom = (token: string): string =>
  `phone-bridge:${token}`;
export const chatSessionRoom = (sessionId: string): string =>
  `chat-session:${sessionId}`;
export const scopeRoom = (scopeId: string): string => `scope:${scopeId}`;
export const userRoom = (userId: string): string => `user:${userId}`;

export const realtimeRoomPrefix = (room: string): string => {
  const idx = room.indexOf(':');
  return idx === -1 ? room : room.slice(0, idx);
};

// The id part of a `<prefix>:<id>` room — the counterpart of the room builders
// above (captureRoom/chatSessionRoom/…). Returns '' for a prefix-only string,
// so an authorizer can reject an empty id. Kept here so every room authorizer
// parses the grammar the same way instead of re-deriving the slice offset.
export const realtimeRoomId = (room: string): string => {
  const idx = room.indexOf(':');
  return idx === -1 ? '' : room.slice(idx + 1);
};

// ── Client → server messages ────────────────────────────────────────────────

export const REALTIME_SUBSCRIBE_MESSAGE = 'subscribe';
export const REALTIME_UNSUBSCRIBE_MESSAGE = 'unsubscribe';

// Client → server command envelope. One socket message name carries every
// plugin-registered command (`command` names the handler, `data` its payload),
// so the single gateway stays generic and plugins never touch socket.io. The
// gateway resolves the caller's request context before dispatching, so a
// command handler runs with the same user/scope/locale scoping as an HTTP call.
export const REALTIME_COMMAND_MESSAGE = 'command';

export interface RealtimeCommandEnvelope {
  command: string;
  data: unknown;
}

// WS ack contract (CLAUDE.md §5.2): plain success/error object, never a
// top-level `event` key, handlers never throw.
export type RealtimeAck = { ok: true } | { error: string };

// Per-connection request context the gateway hands a command handler, mirroring
// backend-core's RequestContextData (structurally identical). Built by the
// multiuser overlay from the handshake identity; empty in single-user mode.
export interface RealtimeRequestContext {
  userId?: string;
  isAdmin?: boolean;
  scopeId?: string;
  accessLevel?: ScopeAccess;
  enabledPluginIds?: ReadonlySet<string>;
  modelConstraints?: ModelConstraintMap[];
  locale?: string;
}

// ── Chat commands (client → server over the socket) ─────────────────────────
// The four turn-entry actions. The turn runs server-side and streams stages +
// the final reply back into the session room (CHAT_STAGE_EVENT /
// CHAT_REPLY_EVENT); the ack only reports that the command was accepted (or why
// it was refused). The socket is the sole turn transport — session CRUD/read
// stays on the chat plugin's HTTP controller.
export const CHAT_SEND_COMMAND = 'chat:send';
export const CHAT_CONFIRM_TOOL_COMMAND = 'chat:confirm-tool';
export const CHAT_CANCEL_TOOL_COMMAND = 'chat:cancel-tool';
export const CHAT_RETRY_COMMAND = 'chat:retry';

export interface ChatSendCommandData {
  sessionId: string;
  message: string;
  images?: string[];
  // Serialized PageContext (kept loose here to avoid a structural dependency).
  pageContext?: unknown;
  // The project scope the client has in force for this turn (#130): the last
  // project the user visited, or the one they picked by hand. A conversation no
  // longer carries a project, so this is how the default scope reaches the
  // server at all — and it is a claim, not an authority: the server reads the
  // project through the caller's scoped client before believing it. Absent when
  // the user is working with no project.
  projectId?: string | null;
}

export interface ChatConfirmToolCommandData {
  sessionId: string;
  messageId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ChatCancelToolCommandData {
  sessionId: string;
  messageId: string;
}

export interface ChatRetryCommandData {
  sessionId: string;
}

// ── Server → client events ──────────────────────────────────────────────────

// Phone-bridge session activity (room `phone-bridge:<token>`). A nudge, not a
// data carrier: the desktop reacts by polling `/results?since=<cursor>`
// immediately, so push and fallback polling share one dedup path (the cursor).
//
// Deliberately ONE event, not the `capture:photo` / `capture:status` split #61
// sketched: the desktop's reaction is identical (repoll by cursor), so separate
// names would only earn their keep with separate handlers — and two events that
// do the same thing invite confusion. Split this only if a handler ever needs
// to treat "new photo" differently from "status changed".
export const PHONE_BRIDGE_UPDATE_EVENT = 'phone-bridge:update';

// Something in the caller's scope changed as a result of an agent turn (rooms
// `scope:<id>` / `user:<id>`, or a broadcast in single-user mode). Maps onto
// the frontend's existing notifyAgentDataChanged() refetch tick.
export const DATA_CHANGED_EVENT = 'data:changed';

// An array, not #61's single `{ pluginId }`: one agent turn can mutate several
// plugins' data (e.g. a logistics tool touching inventory), so one event lists
// every affected plugin instead of firing N events per turn.
export interface DataChangedRealtimePayload {
  pluginIds: string[];
  // "One plugin's SCREEN is stale", not "data changed".
  //
  // An external plugin invalidates its own screen whenever its own world moves
  // — a printer reporting a new temperature every fifteen seconds — and the
  // app-wide refetch tick must not follow, or every open view refetches on
  // somebody else's timer. That is what made the inventory list blink.
  screensOnly?: boolean;
}

// Live progress of an agent turn (room `chat-session:<id>`). Pure progress
// indication: the final assistant message still arrives via the HTTP response.
export const CHAT_STAGE_EVENT = 'chat:stage';

// One stage of the agent loop. `turn` is the loop iteration (1-based, capped
// at the server's max). Tool names are machine ids — the UI resolves the
// human label through the tool's i18n descriptionKey, never from this payload.
export type AgentStage =
  | { type: 'turn_started'; turn: number }
  | { type: 'llm_call_started'; turn: number }
  | { type: 'llm_call_finished'; turn: number }
  | {
      type: 'tool_started';
      turn: number;
      toolName: string;
      permission: PermissionLevel;
    }
  | { type: 'tool_finished'; turn: number; toolName: string; ok: boolean }
  | { type: 'awaiting_confirmation'; turn: number; toolName: string }
  | { type: 'turn_finished' };

export interface ChatStageRealtimePayload {
  sessionId: string;
  stage: AgentStage;
}

// The final result of an agent turn (room `chat-session:<id>`) — the sole
// delivery of the turn's outcome to the client. `result` is an assistant
// message or a structured turn error, typed `unknown` here because those shapes
// live in the chat plugin; the client narrows it with its own guards.
export const CHAT_REPLY_EVENT = 'chat:reply';

export interface ChatReplyRealtimePayload {
  sessionId: string;
  result: unknown;
}

// One of a user's personal secrets (a provider API key, tracking credentials)
// was decrypted and used OUTSIDE that user's own session — a background job, or
// a workspace guest acting in the owner's scope (#63). Delivered to the owner's
// auto-joined `user:<id>` room so their client can surface a notice. Prevention
// against a server operator is out of reach (the server must hold the plaintext
// to use it), so the design makes such use observable instead: this event plus a
// durable SecretAccessLog row. `purpose` is an i18n key, never prose.
export const SECRET_ACCESS_EVENT = 'secret:accessed';

export interface SecretAccessRealtimePayload {
  // Owning plugin of the secret (e.g. "chat", "logistics").
  pluginId: string;
  // i18n key describing what the key was used for (resolved client-side).
  purposeKey: string;
  // Whether a workspace guest (true) or an unattended background job (false)
  // triggered the use — lets the client word the notice.
  byGuest: boolean;
  // ISO timestamp of the access.
  at: string;
}
