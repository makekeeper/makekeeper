// The single socket.io client every plugin frontend shares (#61) — the
// realtime counterpart of api.ts. One lazy singleton socket; consumers
// subscribe to rooms (refcounted, re-joined automatically on reconnect) and
// listen for the event names declared in plugin-contract's realtime.ts.
//
// Realtime is strictly a progress/nudge channel: every consumer must keep
// working with the socket down (poll fallbacks, one-shot HTTP), so failures
// here are silent by design — no toasts, no retry storms beyond socket.io's
// own reconnection backoff.

import { io, type Socket } from 'socket.io-client';
import { ref, type Ref } from 'vue';
import {
  REALTIME_COMMAND_MESSAGE,
  REALTIME_PATH,
  REALTIME_SUBSCRIBE_MESSAGE,
  REALTIME_UNSUBSCRIBE_MESSAGE,
  type RealtimeAck,
} from '@makekeeper/plugin-contract';
import {
  browserTimezone,
  currentLocale,
  getStoredScopeId,
  getStoredToken,
} from './api';

type RealtimeHandler = (payload: unknown) => void;

// The gateway always acks with a valid RealtimeAck; this guard narrows the
// loosely-typed emitWithAck result without an `as` cast (§5.1). The empty-string
// fallback below is an unreachable-in-practice safety net (malformed ack).
function isRealtimeAck(value: unknown): value is RealtimeAck {
  if (typeof value !== 'object' || value === null) return false;
  if ('error' in value) return typeof value.error === 'string';
  return 'ok' in value && value.ok === true;
}

async function emitAck(
  socket: Socket,
  message: string,
  payload: unknown,
): Promise<RealtimeAck> {
  const ack: unknown = await socket.emitWithAck(message, payload);
  return isRealtimeAck(ack) ? ack : { error: '' };
}

// Credential for a device with no user account — the paired phone, whose bridge
// session token is its only identity (#79). Set before subscribing; the gateway
// grants such a socket exactly the one room the token names.
let guestToken: string | null = null;

export function setRealtimeGuestToken(token: string | null): void {
  guestToken = token;
}

let socket: Socket | null = null;
const connected = ref(false);
// Rooms with at least one live subscriber — re-joined on every (re)connect.
const roomRefCounts = new Map<string, number>();

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: REALTIME_PATH,
    // Function form: re-evaluated on every (re)connect attempt, so a login/
    // logout or scope switch takes effect on the next reconnect without
    // tearing the module state down.
    auth: (cb) => {
      const token = getStoredToken();
      const scopeId = getStoredScopeId();
      // Language and zone travel with the handshake because a socket has no
      // headers to put them in — and the chat turn, which runs entirely over
      // this connection, is exactly what needs to know what time it is where
      // the person is.
      const locale = currentLocale();
      const timezone = browserTimezone();
      cb({
        ...(token ? { token } : {}),
        ...(scopeId ? { scopeId } : {}),
        ...(guestToken ? { guestToken } : {}),
        ...(locale ? { locale } : {}),
        ...(timezone ? { timezone } : {}),
      });
    },
  });
  socket.on('connect', () => {
    connected.value = true;
    for (const room of roomRefCounts.keys()) {
      socket?.emit(REALTIME_SUBSCRIBE_MESSAGE, { room });
    }
  });
  socket.on('disconnect', () => {
    connected.value = false;
  });
  return socket;
}

export interface RealtimeApi {
  // Live connection state — consumers use it to pick their poll cadence.
  connected: Ref<boolean>;
  subscribe(room: string): void;
  unsubscribe(room: string): void;
  // Join a room and await the server ack. Unlike `subscribe` (fire-and-forget,
  // refcounted for the room's lifetime), this guarantees membership before the
  // caller proceeds — use it right before triggering server work that will emit
  // into the room, so an event can't outrun the reactive subscribe.
  join(room: string): Promise<RealtimeAck>;
  on(event: string, handler: RealtimeHandler): void;
  off(event: string, handler: RealtimeHandler): void;
  // Send a client→server command and await its ack. The command's own results
  // arrive as server→client events (e.g. a chat turn streams stages + reply
  // into its room); the ack only reports acceptance. No socket.io ack timeout
  // is set — a long-running command (an agent turn) resolves whenever it ends.
  request(command: string, data: unknown): Promise<RealtimeAck>;
}

export function useRealtime(): RealtimeApi {
  return {
    connected,
    subscribe(room: string): void {
      const s = ensureSocket();
      const count = roomRefCounts.get(room) ?? 0;
      roomRefCounts.set(room, count + 1);
      if (count === 0 && s.connected) {
        s.emit(REALTIME_SUBSCRIBE_MESSAGE, { room });
      }
    },
    unsubscribe(room: string): void {
      const count = roomRefCounts.get(room) ?? 0;
      if (count <= 1) {
        roomRefCounts.delete(room);
        if (socket?.connected) {
          socket.emit(REALTIME_UNSUBSCRIBE_MESSAGE, { room });
        }
      } else {
        roomRefCounts.set(room, count - 1);
      }
    },
    on(event: string, handler: RealtimeHandler): void {
      ensureSocket().on(event, handler);
    },
    off(event: string, handler: RealtimeHandler): void {
      socket?.off(event, handler);
    },
    request(command: string, data: unknown): Promise<RealtimeAck> {
      return emitAck(ensureSocket(), REALTIME_COMMAND_MESSAGE, {
        command,
        data,
      });
    },
    join(room: string): Promise<RealtimeAck> {
      return emitAck(ensureSocket(), REALTIME_SUBSCRIBE_MESSAGE, { room });
    },
  };
}

// Force a fresh handshake with the current credentials — call after login,
// logout or an active-scope switch so room membership matches the new session.
export function reconnectRealtime(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}
