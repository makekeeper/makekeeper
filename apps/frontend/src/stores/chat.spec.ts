import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { CHAT_REPLY_EVENT } from '@makekeeper/plugin-contract';

// Since #61 an agent turn is transported over the realtime socket, not an HTTP
// POST: the store emits the command and the reply arrives as a CHAT_REPLY_EVENT
// pushed into the session room. These tests drive that path with a controllable
// realtime double — `request()` mirrors the server by emitting the reply
// (configurable per test) back into the room on the next microtask.
const replyHandlers: Array<(payload: unknown) => void> = [];
let nextReply: (data: Record<string, unknown>) => unknown = () => ({});

const realtimeMock = {
  connected: { value: true },
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  join: vi.fn(async () => ({ ok: true })),
  on: vi.fn((event: string, handler: (payload: unknown) => void) => {
    if (event === CHAT_REPLY_EVENT) replyHandlers.push(handler);
  }),
  off: vi.fn(),
  request: vi.fn(async (_command: string, data: Record<string, unknown>) => {
    const result = nextReply(data);
    // The server accepts the turn (ack ok), then pushes the reply into the
    // room; replay that ordering so resolveTurn sees the same sessionId.
    queueMicrotask(() =>
      replyHandlers.forEach((h) => h({ sessionId: data.sessionId, result })),
    );
    return { ok: true };
  }),
};

vi.mock('@makekeeper/frontend-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@makekeeper/frontend-core')>();
  return { ...actual, useRealtime: () => realtimeMock };
});

// Import AFTER the mock is registered so the store binds to the fake realtime.
const { useChatStore } = await import('./chat');

const resetRealtime = (): void => {
  replyHandlers.length = 0;
  nextReply = () => ({});
  realtimeMock.request.mockClear();
};

// Regression: the first message must NOT vanish after sending. sendMessage
// optimistically pushes the user's bubble, then ensureSession creates a session;
// hydrateFromSession used to replace the whole array and drop that bubble until a
// reload re-fetched it from the server (issue #15 follow-up).
describe('chat store — first message survives session creation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetRealtime();
  });
  afterEach(() => vi.unstubAllGlobals());

  // Minimal fetch router covering the session endpoints sendMessage touches on a
  // cold start (session lookup + listing stay on HTTP; only the turn is socket).
  const stubFetch = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) =>
          ({ ok: true, json: async () => body }) as Response;
        if (url.includes('/api/projects')) return ok([{ id: 'proj_1' }]);
        // getOrCreateSession — a brand-new, empty session (no messages yet).
        if (url.endsWith('/session')) return ok({ id: 'sess_1', messages: [] });
        if (url.endsWith('/sessions')) return ok([]); // loadSessions
        return ok({});
      }),
    );
  };

  it('keeps the user message in the thread after the turn completes', async () => {
    stubFetch();
    // The turn's socket reply carries the assistant message.
    nextReply = () => ({ id: 'msg_a', role: 'assistant', content: 'ответ' });
    const store = useChatStore();
    // No session yet — this is the path that used to wipe the message.
    expect(store.sessionId).toBeNull();

    await store.sendMessage('где ячейка A1?');

    const humanTexts = store.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(humanTexts).toContain('где ячейка A1?');
    // The assistant reply is appended after, not instead of, the user message.
    expect(store.messages.some((m) => m.content === 'ответ')).toBe(true);
    expect(store.sessionId).toBe('sess_1');
  });
});

// Regression: after a reload the user must land back in the chat they were in,
// not the backend's arbitrary "first" session.
describe('chat store — restores the last-active session on reload', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    resetRealtime();
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) =>
          ({ ok: true, json: async () => body }) as Response;
        if (url.includes('/api/projects')) return ok([{ id: 'proj_1' }]);
        if (url.endsWith('/sessions'))
          return ok([{ id: 'sess_1' }, { id: 'sess_2' }]); // loadSessions
        if (url.endsWith('/sessions/sess_2'))
          return ok({ id: 'sess_2', messages: [] });
        if (url.endsWith('/session')) return ok({ id: 'sess_1', messages: [] }); // default
        return ok({});
      }),
    );
  };

  it('opens the persisted session, not the default first one', async () => {
    localStorage.setItem('chat.activeSessionId', 'sess_2');
    stubFetch();
    const store = useChatStore();
    await store.initChat();
    expect(store.sessionId).toBe('sess_2');
  });

  it('falls back to the default session when the remembered one is gone', async () => {
    localStorage.setItem('chat.activeSessionId', 'sess_deleted');
    stubFetch();
    const store = useChatStore();
    await store.initChat();
    expect(store.sessionId).toBe('sess_1');
  });

  it('persists the active session id when it changes', async () => {
    stubFetch();
    const store = useChatStore();
    await store.selectSession('sess_2');
    expect(localStorage.getItem('chat.activeSessionId')).toBe('sess_2');
  });
});

// #130: the chat's project stopped being an anchor it resolved for itself and
// became the scope of each turn. The failure this replaces (#27) — a transient
// /api/projects error re-anchoring the user to the empty global session — is
// structurally gone with the lookup: the store no longer asks which project a
// conversation belongs to, because a conversation belongs to none.
describe("chat store — the project is the turn's scope, not the chat's anchor", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    resetRealtime();
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (seen: string[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url);
        const ok = (body: unknown) =>
          ({ ok: true, json: async () => body }) as Response;
        if (url.endsWith('/session')) return ok({ id: 'sess_1', messages: [] });
        if (url.endsWith('/sessions')) return ok([]);
        return ok({});
      }),
    );
  };

  it('opens a chat without asking which project it belongs to', async () => {
    const seen: string[] = [];
    stubFetch(seen);
    const store = useChatStore();
    await store.initChat();
    expect(store.sessionId).toBe('sess_1');
    // No project lookup, and no project-scoped session route.
    expect(seen.some((url) => url.includes('/api/projects'))).toBe(false);
    expect(seen.every((url) => url.startsWith('/api/chat/'))).toBe(true);
  });

  it('sends the scope in force with the turn', async () => {
    stubFetch([]);
    nextReply = () => ({ id: 'a1', role: 'assistant', content: 'ok' });
    const store = useChatStore();
    store.visitProject('proj_2');

    await store.sendMessage('what is left to buy?');

    const [, data] = realtimeMock.request.mock.calls[0];
    expect((data as { projectId: string | null }).projectId).toBe('proj_2');
  });

  // The point of the sticky scope: it holds after the user walks off the
  // project page, and a reload on a project-less screen must not change where
  // the next file goes.
  it('remembers the visited project across a reload', async () => {
    stubFetch([]);
    const store = useChatStore();
    store.visitProject('proj_2');
    expect(localStorage.getItem('chat.projectId')).toBe('proj_2');

    setActivePinia(createPinia());
    const reloaded = useChatStore();
    expect(reloaded.projectId).toBe('proj_2');
  });

  // "No project" is a choice the user can make, and the only way to say
  // "answer about nothing in particular" — no screen means it.
  it('lets the scope be dropped by hand, and sends none afterwards', async () => {
    stubFetch([]);
    nextReply = () => ({ id: 'a1', role: 'assistant', content: 'ok' });
    const store = useChatStore();
    store.visitProject('proj_2');
    store.setProject(null);
    expect(localStorage.getItem('chat.projectId')).toBeNull();

    await store.sendMessage('hi');

    const [, data] = realtimeMock.request.mock.calls[0];
    expect((data as { projectId: string | null }).projectId).toBeNull();
  });

  // A project can be deleted, or leave the readable scope, while the id sits in
  // localStorage. The server answering "no project" for the scope it was sent
  // is the only signal that has happened — without acting on it the dead id
  // keeps riding on every turn while the context line already says otherwise.
  it('drops a scope the server would not name back', () => {
    stubFetch([]);
    const store = useChatStore();
    store.visitProject('proj_2');

    store.reconcileProject(null);

    expect(store.projectId).toBeNull();
    expect(localStorage.getItem('chat.projectId')).toBeNull();
  });

  // Only ever drops: which project is in force is the client's own answer, so a
  // server that names one must not be able to set or change it.
  it('leaves a scope the server confirms, and never adopts one', () => {
    stubFetch([]);
    const store = useChatStore();
    store.visitProject('proj_2');

    store.reconcileProject({ id: 'proj_2' });
    expect(store.projectId).toBe('proj_2');

    store.setProject(null);
    store.reconcileProject({ id: 'proj_9' });
    expect(store.projectId).toBeNull();
  });

  // Logging out must not leave the next account working inside a project it
  // cannot even see.
  it('drops the scope on reset', () => {
    stubFetch([]);
    const store = useChatStore();
    store.visitProject('proj_2');
    store.reset();
    expect(store.projectId).toBeNull();
    expect(localStorage.getItem('chat.projectId')).toBeNull();
  });
});

// Regression (#21): a failed LLM turn persists no assistant message on the
// backend, so the error bubble + Retry button used to live only in memory and
// vanish on reload / chat switch. The store now remembers the failure per session
// and rebuilds the bubble on hydrate. Since #61 the failure arrives as an
// AgentTurnError carried by the turn's socket reply, not an HTTP response.
describe('chat store — error + retry survive reload and chat switch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    resetRealtime();
  });
  afterEach(() => vi.unstubAllGlobals());

  const agentError = {
    error: true,
    message: 'rate limited',
    provider: 'OpenAI',
    status: 429,
  };

  // The turn fails on sess_1 (socket reply = AgentTurnError); sess_2 is empty;
  // re-opening sess_1 returns its persisted user message (no assistant reply —
  // the turn errored) over HTTP.
  const stubFetch = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = (body: unknown) =>
          ({ ok: true, json: async () => body }) as Response;
        if (url.includes('/api/projects')) return ok([{ id: 'proj_1' }]);
        if (url.endsWith('/sessions/sess_2'))
          return ok({ id: 'sess_2', messages: [] });
        if (url.endsWith('/sessions/sess_1'))
          return ok({
            id: 'sess_1',
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 0 }],
          });
        if (url.endsWith('/session')) return ok({ id: 'sess_1', messages: [] });
        if (url.endsWith('/sessions')) return ok([]);
        return ok({});
      }),
    );
  };

  const errorBubble = (store: ReturnType<typeof useChatStore>) =>
    store.messages.find((m) => m.canRetry);

  it('shows a retryable error bubble with the provider detail on failure', async () => {
    stubFetch();
    nextReply = () => agentError;
    const store = useChatStore();
    await store.sendMessage('hi');
    const bubble = errorBubble(store);
    expect(bubble).toBeDefined();
    expect(bubble?.errorDetail).toContain('OpenAI');
    expect(bubble?.errorDetail).toContain('429');
  });

  it('restores the error bubble after switching away and back', async () => {
    stubFetch();
    nextReply = () => agentError;
    const store = useChatStore();
    await store.sendMessage('hi');
    await store.selectSession('sess_2');
    expect(errorBubble(store)).toBeUndefined(); // clean chat, no error
    await store.selectSession('sess_1');
    const restored = errorBubble(store);
    expect(restored).toBeDefined();
    expect(restored?.errorDetail).toContain('429');
  });

  it('restores the error bubble on a fresh store (page reload)', async () => {
    stubFetch();
    nextReply = () => agentError;
    const first = useChatStore();
    await first.sendMessage('hi');
    // Simulate reload: brand-new Pinia; the store reads persisted failures.
    setActivePinia(createPinia());
    const reloaded = useChatStore();
    await reloaded.selectSession('sess_1');
    expect(errorBubble(reloaded)).toBeDefined();
  });

  it('forgets the failure once a later turn succeeds', async () => {
    stubFetch();
    nextReply = () => agentError;
    const store = useChatStore();
    await store.sendMessage('hi');
    expect(errorBubble(store)).toBeDefined();
    // A successful retry clears the remembered error — the retry turn's socket
    // reply carries an assistant message.
    nextReply = () => ({ id: 'a1', role: 'assistant', content: 'ok' });
    const bubble = errorBubble(store);
    if (bubble) await store.retryLastTurn(bubble);
    expect(errorBubble(store)).toBeUndefined();
    await store.selectSession('sess_2');
    await store.selectSession('sess_1');
    expect(errorBubble(store)).toBeUndefined();
  });
});
