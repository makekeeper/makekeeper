import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  CHAT_CANCEL_TOOL_COMMAND,
  CHAT_CONFIRM_TOOL_COMMAND,
  CHAT_REPLY_EVENT,
  CHAT_RETRY_COMMAND,
  CHAT_SEND_COMMAND,
  CHAT_STAGE_EVENT,
  chatSessionRoom,
  type AgentStage,
  type AttachmentPresence,
  type ChatReplyRealtimePayload,
  type ChatStageRealtimePayload,
  type PageContext,
  type ToolConfirmSummary,
} from '@makekeeper/plugin-contract';
import {
  notifyAgentDataChanged,
  apiFetch,
  useRealtime,
} from '@makekeeper/frontend-core';
import { i18n } from '../i18n';

// `kind` classifies a message so the UI can render agent tool activity as a
// compact status chip instead of dumping raw tool JSON into a chat bubble.
// `tool_executing` is a transient, client-only state shown while a confirmed
// DESTRUCTIVE call runs; it resolves to `tool_response` once the turn returns.
export type MessageKind =
  | 'text'
  | 'tool_call'
  | 'tool_response'
  | 'tool_cancelled'
  | 'tool_executing';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentKey?: string;
  time: string;
  pending?: boolean;
  kind: MessageKind;
  toolName?: string;
  image?: string | null;
  toolCall?: {
    type: 'tool_call_pending';
    name: string;
    args: Record<string, unknown>;
    // Resolved, localized confirmation sentence (i18n key + named params). When
    // present the card renders `t(key, params)` instead of the raw name + JSON.
    // `lines` is an optional itemized preview (an order's components, a stock
    // receipt) so a photo-parsed batch is verified row by row (#72). Shares the
    // backend's `ToolConfirmSummary` shape so the two can't drift.
    summary?: ToolConfirmSummary;
    // The pending mutation's data came from recognition (a photo turn) (#72) —
    // the card shows a "verify what was recognised" hint.
    recognized?: boolean;
  };
  // A failed agent turn: `canRetry` shows the retry button, `errorDetail` is the raw
  // provider reason revealed in a collapsible <details> so the failing side is clear.
  canRetry?: boolean;
  errorDetail?: string;
}

interface ServerMessage {
  id: string;
  role: string;
  content: string;
  imageData?: string | null;
  createdAt: string;
}

// A verdict for every attachment a session's messages reference (#112, #127).
// Sent with the history because a message row stores only the URL, and the UI
// must know whether it is a picture BEFORE it renders: asking for a preview of
// a non-image serves the original, i.e. downloads the whole file to draw a
// broken icon. An attachment that is gone is reported as such — the list is
// total, so "no entry" means the history has not loaded, never "deleted".
export type SessionAttachment = AttachmentPresence;

interface StoredMessagePayload {
  type?: string;
  name?: string;
  args?: Record<string, unknown>;
  response?: unknown;
  summary?: ToolConfirmSummary;
  recognized?: boolean;
}

// A failed agent turn carried by the CHAT_REPLY_EVENT instead of an assistant
// message (#61). Mirrors the backend AgentTurnError.
interface AgentTurnError {
  error: true;
  message: string;
  provider?: string;
  status?: number;
}

const isAgentError = (value: unknown): value is AgentTurnError =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  value.error === true;

// A persisted assistant/user message as carried by the turn reply — the shape
// finalizeTurn renders into the log. Narrowed with a guard so no `as` is needed.
interface ReplyServerMessage {
  id: string;
  role: string;
  content: string;
}

const isServerMessage = (value: unknown): value is ReplyServerMessage =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'role' in value &&
  'content' in value &&
  typeof value.id === 'string' &&
  typeof value.role === 'string' &&
  typeof value.content === 'string';

// Live connection state for the AI assistant header.
export type ConnectionStatus =
  | 'unknown'
  | 'checking'
  | 'connected'
  | 'error'
  | 'none';

// One chat = one persisted AIChatSession. Summary shown in the chat switcher.
export interface ChatSessionSummary {
  id: string;
  createdAt: string;
  title: string | null;
  messageCount: number;
  // The project of this chat's most recent turn (#130), or null when its turns
  // carried none. The list is one flat set of conversations now, so this is
  // what tells two same-looking titles apart.
  project: { id: string; name: string } | null;
}

// Human-typed messages are plain text; tool call/response payloads are JSON
// with a `type` field. Used to build the composer's up/down recall history.
const isHumanText = (content: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(content);
    return !(typeof parsed === 'object' && parsed !== null && 'type' in parsed);
  } catch {
    return true;
  }
};

const t = i18n.global.t;

const initialMessage = (): ChatMessage => ({
  id: 'init',
  role: 'assistant',
  content: '',
  contentKey: 'chat.initialMessage',
  time: '',
  kind: 'text',
});

const randomId = (): string =>
  'local_' + Math.random().toString(36).substring(2, 9);

const nowTime = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
};

// Cross-screen AI assistant state (§5.3): the session and message log outlive
// the components that render them, so they live in this Pinia store.
export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([initialMessage()]);
  // Metadata for the attachments the loaded history references (#112) — what
  // the bubbles need to render a picture or a file chip.
  const attachments = ref<SessionAttachment[]>([]);
  const sessionId = ref<string | null>(null);
  const isSending = ref(false);

  // Live stage of the in-flight agent turn (#61), pushed over the realtime
  // socket into this session's room. Progress indication only: it stays null
  // with the socket down and the UI falls back to the generic typing dots.
  const liveStage = ref<AgentStage | null>(null);
  const realtime = useRealtime();
  const isStagePayload = (value: unknown): value is ChatStageRealtimePayload =>
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    'stage' in value;
  realtime.on(CHAT_STAGE_EVENT, (payload) => {
    if (!isStagePayload(payload) || payload.sessionId !== sessionId.value)
      return;
    liveStage.value =
      payload.stage.type === 'turn_finished' ? null : payload.stage;
  });
  watch(sessionId, (id, old) => {
    if (old) realtime.unsubscribe(chatSessionRoom(old));
    if (id) realtime.subscribe(chatSessionRoom(id));
  });
  watch(isSending, (sending) => {
    if (!sending) liveStage.value = null;
  });

  // --- One agent turn at a time (#61) ---------------------------------------
  // A turn is resolved by the socket `chat:reply` event (the sole turn
  // transport — chat is a core plugin), or by the command ack when the server
  // refuses the turn outright. A confirm/cancel turn also carries the chip
  // message whose kind flips on resolution so its spinner never hangs. A long
  // backstop timer guards against a turn that never reports back at all.
  interface TurnContext {
    id: string;
    chipMsg?: ChatMessage;
    chipKind?: MessageKind;
  }
  let activeTurn: TurnContext | null = null;
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  const TURN_BACKSTOP_MS = 600000; // 10 min — far beyond any real turn

  const clearTurnTimer = (): void => {
    if (turnTimer) {
      clearTimeout(turnTimer);
      turnTimer = null;
    }
  };

  const beginTurn = (chip?: {
    msg: ChatMessage;
    kind: MessageKind;
  }): string => {
    clearTurnTimer();
    const id = randomId();
    activeTurn = chip ? { id, chipMsg: chip.msg, chipKind: chip.kind } : { id };
    isSending.value = true;
    turnTimer = setTimeout(() => resolveTurn(id, {}), TURN_BACKSTOP_MS);
    return id;
  };

  // Apply a turn result exactly once. `reply` is the value the socket event
  // carries: an assistant message, a structured AgentTurnError, or an
  // empty/invalid value → the generic server-error bubble.
  const finalizeTurn = (reply: unknown): void => {
    if (isAgentError(reply)) {
      addErrorMessage(reply);
      return;
    }
    if (isServerMessage(reply)) {
      messages.value.push(buildMessage(reply.role, reply.content, reply.id));
      clearSessionError();
      // The turn may have run agent tools that mutated backend data; nudge
      // dependent views to refetch (the scoped data:changed push covers other
      // clients).
      notifyAgentDataChanged();
      return;
    }
    addErrorMessage({});
  };

  const resolveTurn = (id: string, reply: unknown): void => {
    if (!activeTurn || activeTurn.id !== id) return;
    const ctx = activeTurn;
    activeTurn = null;
    clearTurnTimer();
    if (ctx.chipMsg && ctx.chipKind) ctx.chipMsg.kind = ctx.chipKind;
    finalizeTurn(reply);
    isSending.value = false;
    loadSessions().catch(() => undefined);
  };

  // End a turn locally without any server reply (e.g. no session could open).
  const endTurnLocally = (): void => {
    activeTurn = null;
    clearTurnTimer();
    isSending.value = false;
  };

  const isReplyPayload = (v: unknown): v is ChatReplyRealtimePayload =>
    typeof v === 'object' && v !== null && 'sessionId' in v && 'result' in v;
  realtime.on(CHAT_REPLY_EVENT, (payload) => {
    if (!isReplyPayload(payload) || payload.sessionId !== sessionId.value)
      return;
    if (!activeTurn) return;
    resolveTurn(activeTurn.id, payload.result);
  });

  // Run a turn over the socket — the sole turn transport (#61; chat is a core
  // plugin). The reply arrives via the `chat:reply` room event; the ack only
  // reports acceptance, so a refusal (validation/auth/unknown command) resolves
  // the turn with its error. With the socket down the turn can't start, so it
  // resolves to the generic server-error bubble immediately.
  const dispatchTurn = async (
    turnId: string,
    turnSessionId: string,
    command: string,
    data: Record<string, unknown>,
  ): Promise<void> => {
    if (!realtime.connected.value) {
      resolveTurn(turnId, {});
      return;
    }
    try {
      // Guarantee room membership before the turn emits its events (the reactive
      // subscribe runs on a later flush, which could race the turn).
      await realtime.join(chatSessionRoom(turnSessionId));
      const ack = await realtime.request(command, data);
      if ('error' in ack) {
        resolveTurn(turnId, { error: true, message: ack.error });
      }
      // ok → the reply arrives (or already arrived) via the room event.
    } catch {
      resolveTurn(turnId, {});
    }
  };

  // Remember which chat the user was in across a page reload — Pinia state resets
  // on reload, and the backend's default-session lookup returns an arbitrary
  // (first) session, so without this the wrong chat opened.
  const ACTIVE_SESSION_KEY = 'chat.activeSessionId';
  watch(sessionId, (id) => {
    try {
      if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
      else localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {
      // Private-mode / storage-disabled: persistence is best-effort, never fatal.
    }
  });

  // A failed agent turn persists NO assistant message on the backend — the LLM
  // error is returned to the client (HTTP 200 AgentTurnError), never written to
  // history. So the error bubble + Retry button lived only in `messages` and
  // vanished as soon as `hydrateFromSession` rebuilt the log from server history
  // (page reload OR chat switch). We remember the last failure per session — in
  // memory (survives chat switching, the store outlives the view) and mirrored to
  // localStorage (survives reload) — and rebuild the same bubble on hydrate, so
  // the error indication, its detail and Retry all survive both (#21).
  const SESSION_ERRORS_KEY = 'chat.sessionErrors';
  const readSessionErrors = (): Record<string, AgentTurnError> => {
    try {
      const raw = localStorage.getItem(SESSION_ERRORS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, AgentTurnError>)
        : {};
    } catch {
      return {};
    }
  };
  const sessionErrors =
    ref<Record<string, AgentTurnError>>(readSessionErrors());
  watch(
    sessionErrors,
    (map) => {
      try {
        localStorage.setItem(SESSION_ERRORS_KEY, JSON.stringify(map));
      } catch {
        // Best-effort, mirrors ACTIVE_SESSION_KEY above.
      }
    },
    { deep: true },
  );

  // Drop the remembered failure for the active session once a turn succeeds, so a
  // later reload/switch doesn't resurrect an already-resolved error.
  const clearSessionError = (): void => {
    const id = sessionId.value;
    if (!id || !(id in sessionErrors.value)) return;
    const next = { ...sessionErrors.value };
    delete next[id];
    sessionErrors.value = next;
  };

  // Real connection status of the active (default) AI provider, shown in the
  // chat header. `activeProviderName` is the name of that connection.
  const connectionStatus = ref<ConnectionStatus>('unknown');
  const activeProviderName = ref<string | null>(null);

  // Multi-chat state: the list of chats for the switcher and the human-typed
  // messages of the current chat (for the composer's up/down recall).
  const sessions = ref<ChatSessionSummary[]>([]);
  const inputHistory = ref<string[]>([]);

  // The project scope the assistant works in (#130).
  //
  // NOT the chat's project — a conversation has none. This is the default scope
  // the next turn runs in: the last project the user visited, or the one they
  // set by hand in the context line. It used to be a lazily-resolved "first
  // project of the scope", cached once and never moved, which is precisely how
  // a user on the Inventory page ended up talking about a project they had
  // never opened and dropping files into it.
  //
  // Persisted in the browser so a reload on a project-less screen does not
  // silently change where the next file goes; cleared on logout with the rest
  // of the store.
  const STICKY_PROJECT_KEY = 'chat.projectId';
  const readStickyProject = (): string | null => {
    try {
      return localStorage.getItem(STICKY_PROJECT_KEY);
    } catch {
      return null;
    }
  };
  const projectId = ref<string | null>(readStickyProject());
  // Synchronously: the scope changes on navigation and on a click in the
  // context line, and either can be the last thing that happens before a
  // reload. Deferred to the post-flush queue, that reload reads the previous
  // scope back and the next file goes somewhere the user was already told it
  // would not.
  watch(
    projectId,
    (id) => {
      try {
        if (id) localStorage.setItem(STICKY_PROJECT_KEY, id);
        else localStorage.removeItem(STICKY_PROJECT_KEY);
      } catch {
        // Private-mode / storage-disabled: persistence is best-effort, never fatal.
      }
    },
    { flush: 'sync' },
  );

  // Navigation moved onto a project's page: it becomes the scope, overriding a
  // hand-picked one. Called by the shell for every project ORef a view
  // publishes, so "where I am" and "what the assistant is on" stay the same
  // answer without the store knowing anything about routes.
  const visitProject = (id: string): void => {
    if (id !== projectId.value) projectId.value = id;
  };

  // The user's own choice from the context line, including "No project" (null),
  // which is the only way to say "answer about nothing in particular" — there
  // is no screen that means it.
  const setProject = (id: string | null): void => {
    projectId.value = id;
  };

  // What the server made of the scope we sent it. A project it would not name
  // back no longer exists for this user — deleted, or gone from the readable
  // scope — and the id has to go with it: the browser cannot tell a live id
  // from a dead one, and a dead one left alone keeps riding on every turn and
  // every project-files request while the context line already says "No
  // project". Persisted stickiness makes that outlive the reload, too.
  //
  // Only ever drops the value, never sets one: naming the scope is the client's
  // job (visit / pick), and the server's answer is the one thing it cannot know.
  const reconcileProject = (resolved: { id: string } | null): void => {
    if (projectId.value && !resolved) projectId.value = null;
  };

  // Reachability of the default provider via the aggregate status endpoint —
  // usable by every user (config listing/test are admin-only in multi-user
  // mode, and the header must work for regular accounts too).
  const refreshConnection = async (): Promise<void> => {
    connectionStatus.value = 'checking';
    try {
      const res = await apiFetch('/api/chat/providers/active-status');
      if (!res.ok) {
        connectionStatus.value = 'error';
        activeProviderName.value = null;
        return;
      }
      const status = (await res.json()) as { name: string | null; ok: boolean };
      if (!status.name) {
        connectionStatus.value = 'none';
        activeProviderName.value = null;
        return;
      }
      activeProviderName.value = status.name;
      connectionStatus.value = status.ok ? 'connected' : 'error';
    } catch {
      connectionStatus.value = 'error';
      activeProviderName.value = null;
    }
  };

  // Classify a stored message. Human/assistant text stays as-is; agent tool
  // payloads become typed metadata (no raw JSON leaks into the chat) that the UI
  // renders as a compact status chip or, for a pending call, a confirm card.
  const classify = (
    raw: string,
  ): Pick<ChatMessage, 'content' | 'kind' | 'toolName' | 'toolCall'> => {
    let parsed: StoredMessagePayload | null = null;
    try {
      parsed = JSON.parse(raw) as StoredMessagePayload;
    } catch {
      return { content: raw, kind: 'text' };
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      return { content: raw, kind: 'text' };
    }
    switch (parsed.type) {
      case 'tool_call_pending':
        return {
          content: '',
          kind: 'text',
          toolCall: {
            type: 'tool_call_pending',
            name: parsed.name ?? '',
            args: parsed.args ?? {},
            summary: parsed.summary,
            recognized: parsed.recognized,
          },
        };
      case 'tool_call':
        return { content: '', kind: 'tool_call', toolName: parsed.name };
      case 'tool_response':
        return { content: '', kind: 'tool_response', toolName: parsed.name };
      case 'tool_call_cancelled':
        return { content: '', kind: 'tool_cancelled', toolName: parsed.name };
      default:
        return { content: raw, kind: 'text' };
    }
  };

  const buildMessage = (
    role: string,
    raw: string,
    id?: string,
    time?: string,
    image?: string | null,
  ): ChatMessage => ({
    id: id || randomId(),
    role: role === 'user' ? 'user' : 'assistant',
    time: time ?? nowTime(),
    image: image ?? null,
    ...classify(raw),
  });

  // Plain (already-resolved) text message — user input, status and error lines.
  const addMessage = (
    role: 'user' | 'assistant',
    content: string,
    id?: string,
    image?: string | null,
  ): ChatMessage => {
    const msg: ChatMessage = {
      id: id || randomId(),
      role,
      content,
      time: nowTime(),
      kind: 'text',
      image: image ?? null,
    };
    messages.value.push(msg);
    return msg;
  };

  // Build a retryable error bubble: a short human line plus the raw provider reason
  // (origin + message), which the UI reveals in a collapsible <details>. Called with
  // an empty object for bare network failures, which carry no structured detail.
  const buildErrorBubble = (err: Partial<AgentTurnError>): ChatMessage => {
    const detailParts: string[] = [];
    const origin = [err.provider, err.status].filter(Boolean).join(' · ');
    if (origin) detailParts.push(origin);
    if (err.message) detailParts.push(err.message);
    return {
      id: randomId(),
      role: 'assistant',
      content: t('agent.serverError'),
      time: nowTime(),
      kind: 'text',
      canRetry: true,
      errorDetail: detailParts.join('\n') || undefined,
    };
  };

  // Push the error bubble AND remember the failure for the active session, so the
  // bubble + Retry survive a reload / chat switch (rebuilt in hydrateFromSession).
  const addErrorMessage = (err: Partial<AgentTurnError>): ChatMessage => {
    const msg = buildErrorBubble(err);
    messages.value.push(msg);
    const id = sessionId.value;
    if (id) {
      sessionErrors.value = {
        ...sessionErrors.value,
        [id]: {
          error: true,
          message: err.message ?? '',
          provider: err.provider,
          status: err.status,
        },
      };
    }
    return msg;
  };

  // Load a session (id + its persisted messages) into the live view and rebuild
  // the composer recall history from its human messages.
  const hydrateFromSession = (
    session: {
      id: string;
      messages?: ServerMessage[];
      attachments?: SessionAttachment[];
    },
    // Rebuild a retryable error bubble from the remembered failure (#21). Off for
    // the mid-send splice in ensureSession, which is re-appending optimistic
    // messages onto a live turn, not opening/switching a chat.
    restoreError = true,
  ): void => {
    sessionId.value = session.id;
    attachments.value = session.attachments ?? [];
    const serverMsgs = session.messages ?? [];
    messages.value = [
      initialMessage(),
      ...serverMsgs.map((m) =>
        buildMessage(
          m.role,
          m.content,
          m.id,
          new Date(m.createdAt).toLocaleTimeString(i18n.global.locale.value, {
            hour: '2-digit',
            minute: '2-digit',
          }),
          m.imageData,
        ),
      ),
    ];
    const failure = restoreError ? sessionErrors.value[session.id] : undefined;
    if (failure) messages.value.push(buildErrorBubble(failure));
    inputHistory.value = serverMsgs
      .filter((m) => m.role === 'user' && isHumanText(m.content))
      .map((m) => m.content);
  };

  // One set of session routes (#130). There used to be two — a project-anchored
  // base and a global fallback — and choosing between them required resolving
  // "the" project first, which is what pinned every conversation to the first
  // project of the scope forever. A chat belongs to the user; the project rides
  // with the turn instead.
  const SESSION_BASE = '/api/chat';

  const loadSessions = async (): Promise<void> => {
    const res = await apiFetch(`${SESSION_BASE}/sessions`).catch(() => null);
    if (!res || !res.ok) return;
    sessions.value = (await res.json()) as ChatSessionSummary[];
  };

  // First open: restore the chat the user was last in (persisted across reload),
  // falling back to the backend's default session. Loads the chat list too.
  const initChat = async (): Promise<void> => {
    await loadSessions();
    if (sessionId.value) return;
    // Only restore a remembered session that is still in the list — otherwise
    // it has been deleted, or belongs to another account.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ACTIVE_SESSION_KEY);
    } catch {
      stored = null;
    }
    if (stored && sessions.value.some((s) => s.id === stored)) {
      await selectSession(stored);
    }
    if (!sessionId.value) {
      const res = await apiFetch(`${SESSION_BASE}/session`).catch(() => null);
      if (res && res.ok) hydrateFromSession(await res.json());
    }
  };

  // Start a fresh chat (new context) instead of extending the current thread.
  const newChat = async (): Promise<void> => {
    const res = await apiFetch(`${SESSION_BASE}/sessions`, {
      method: 'POST',
    }).catch(() => null);
    if (!res || !res.ok) return;
    hydrateFromSession(await res.json());
    await loadSessions();
  };

  const selectSession = async (id: string): Promise<void> => {
    if (id === sessionId.value) return;
    const res = await apiFetch(`/api/chat/sessions/${id}`).catch(() => null);
    if (!res || !res.ok) return;
    hydrateFromSession(await res.json());
  };

  const deleteSession = async (id: string): Promise<void> => {
    const res = await apiFetch(`/api/chat/sessions/${id}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (!res || !res.ok) return;
    // Forget any remembered failure for the removed chat (#21).
    if (id in sessionErrors.value) {
      const next = { ...sessionErrors.value };
      delete next[id];
      sessionErrors.value = next;
    }
    if (id === sessionId.value) {
      sessionId.value = null;
      messages.value = [initialMessage()];
      inputHistory.value = [];
    }
    await loadSessions();
    // Fall into the newest remaining chat when the active one was removed.
    if (!sessionId.value && sessions.value.length) {
      await selectSession(sessions.value[0].id);
    }
  };

  // Reconcile the sidebar after a session was changed elsewhere (the project
  // AI-history panel deleted/renamed/pinned it, #59). Mirrors deleteSession's
  // cleanup but without re-issuing the HTTP DELETE the other view already ran.
  const syncSessionsAfterExternalChange = async (
    deletedId?: string,
  ): Promise<void> => {
    if (deletedId) {
      if (deletedId in sessionErrors.value) {
        const next = { ...sessionErrors.value };
        delete next[deletedId];
        sessionErrors.value = next;
      }
      if (deletedId === sessionId.value) {
        sessionId.value = null;
        messages.value = [initialMessage()];
        inputHistory.value = [];
      }
    }
    await loadSessions();
    if (deletedId && !sessionId.value && sessions.value.length) {
      await selectSession(sessions.value[0].id);
    }
  };

  const ensureSession = async (): Promise<string | null> => {
    if (sessionId.value) return sessionId.value;
    const res = await apiFetch(`${SESSION_BASE}/session`).catch(() => null);
    if (!res || !res.ok) return null;
    const session = await res.json();
    // sendMessage has already optimistically pushed the user's message before
    // calling us, so we must NOT let hydrateFromSession replace the whole array —
    // that made the first message vanish until reload. A brand-new session is
    // empty, so just adopt its id; if it happens to carry prior history, splice
    // that in front of the pending optimistic message(s) instead of dropping them.
    const serverMsgs = session.messages ?? [];
    if (serverMsgs.length) {
      const pending = messages.value.slice(1); // everything after the greeting
      hydrateFromSession(session, false);
      messages.value.push(...pending);
    } else {
      sessionId.value = session.id;
    }
    return session.id;
  };

  const sendMessage = async (
    text: string,
    images?: string[],
    pageContext?: PageContext,
  ): Promise<void> => {
    const imgs = images ?? [];
    if ((!text.trim() && !imgs.length) || isSending.value) return;
    // Echo one bubble per image, then the text bubble — mirroring how the
    // backend persists the turn (one user message per image + the text message).
    for (const img of imgs) addMessage('user', '', undefined, img);
    if (text.trim()) {
      addMessage('user', text);
      inputHistory.value.push(text);
    }
    const turnId = beginTurn();
    try {
      const id = await ensureSession();
      if (!id) {
        endTurnLocally();
        addMessage('assistant', t('agent.sessionError'));
        return;
      }
      // Attachments are persisted at the very start of the turn (before the model
      // replies), so nudge data-dependent views to refresh promptly — otherwise a
      // file uploaded via chat wouldn't appear in the project's Files until the
      // whole (possibly slow) reply lands. The post-turn signal reconciles.
      if (imgs.length) {
        setTimeout(() => notifyAgentDataChanged(), 500);
        setTimeout(() => notifyAgentDataChanged(), 1500);
      }
      // Per-user locale rides the socket handshake (issue #18).
      await dispatchTurn(turnId, id, CHAT_SEND_COMMAND, {
        sessionId: id,
        message: text,
        images: imgs,
        pageContext,
        // The scope the panel has been stating all along (#130) travels with the
        // turn: a conversation carries no project, so this is the only thing
        // that tells the server which one the user is working in.
        projectId: projectId.value,
      });
    } catch {
      resolveTurn(turnId, {});
    }
  };

  // Back to a pristine store — called when the signed-in user changes
  // (login/logout in multi-user mode), so one account's chats, connection
  // state and project scope never leak into the next session. The sticky
  // project is persisted, so clearing the ref here is what erases it.
  const reset = (): void => {
    sessionId.value = null;
    messages.value = [initialMessage()];
    attachments.value = [];
    sessions.value = [];
    inputHistory.value = [];
    projectId.value = null;
    endTurnLocally();
    liveStage.value = null;
    connectionStatus.value = 'unknown';
    activeProviderName.value = null;
    sessionErrors.value = {};
  };

  // Re-run the last agent turn after a transient failure. Drops the error bubble
  // being retried, then resumes the loop server-side from the persisted history.
  const retryLastTurn = async (msg: ChatMessage): Promise<void> => {
    const id = sessionId.value;
    if (!id || isSending.value) return;
    messages.value = messages.value.filter((m) => m.id !== msg.id);
    const turnId = beginTurn();
    await dispatchTurn(turnId, id, CHAT_RETRY_COMMAND, { sessionId: id });
  };

  const confirmTool = async (msg: ChatMessage): Promise<void> => {
    const id = sessionId.value;
    if (!msg.toolCall || !id) return;
    const toolName = msg.toolCall.name;
    const toolArgs = msg.toolCall.args;
    // Swap the confirm card for a running-status chip (not a raw text bubble):
    // clear the pending call and mark the message as executing. The chip
    // resolves to `tool_response` when the turn reports back (resolveTurn).
    msg.toolCall = undefined;
    msg.content = '';
    msg.toolName = toolName;
    msg.kind = 'tool_executing';
    const turnId = beginTurn({ msg, kind: 'tool_response' });
    await dispatchTurn(turnId, id, CHAT_CONFIRM_TOOL_COMMAND, {
      sessionId: id,
      messageId: msg.id,
      toolName,
      args: toolArgs,
    });
  };

  const cancelTool = async (msg: ChatMessage): Promise<void> => {
    const id = sessionId.value;
    if (!id) return;
    const toolName = msg.toolCall?.name ?? '';
    // Render the cancellation as a status chip, mirroring the persisted
    // tool_call_cancelled message rather than a raw text bubble.
    msg.toolCall = undefined;
    msg.content = '';
    msg.toolName = toolName;
    msg.kind = 'tool_cancelled';
    const turnId = beginTurn({ msg, kind: 'tool_cancelled' });
    await dispatchTurn(turnId, id, CHAT_CANCEL_TOOL_COMMAND, {
      sessionId: id,
      messageId: msg.id,
    });
  };

  return {
    messages,
    attachments,
    sessionId,
    isSending,
    liveStage,
    connectionStatus,
    activeProviderName,
    sessions,
    inputHistory,
    projectId,
    visitProject,
    setProject,
    reconcileProject,
    reset,
    refreshConnection,
    initChat,
    newChat,
    selectSession,
    deleteSession,
    syncSessionsAfterExternalChange,
    loadSessions,
    sendMessage,
    retryLastTurn,
    confirmTool,
    cancelTool,
  };
});
