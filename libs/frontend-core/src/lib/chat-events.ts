import { readonly, ref, type Ref } from 'vue';

// Cross-plugin request to open a specific chat session in the app-shell sidebar
// (#59). A plugin view (e.g. the project AI-history tab) calls requestChatSession;
// the shell watches useChatSessionRequest, opens the panel and selects the session.
// The monotonic `seq` lets the shell react even when the same session is requested
// twice in a row (a bare ref of the payload wouldn't re-trigger on identical value).
// `messageId` is carried for a future scroll-to-message; the shell may ignore it.
export interface ChatSessionRequest {
  seq: number;
  sessionId: string;
  messageId?: string;
}

const chatSessionRequest = ref<ChatSessionRequest | null>(null);

export const requestChatSession = (payload: {
  sessionId: string;
  messageId?: string;
}): void => {
  chatSessionRequest.value = {
    seq: (chatSessionRequest.value?.seq ?? 0) + 1,
    sessionId: payload.sessionId,
    messageId: payload.messageId,
  };
};

export const useChatSessionRequest = (): Readonly<
  Ref<ChatSessionRequest | null>
> => readonly(chatSessionRequest);

// Cross-plugin request to open the assistant panel with the composer pre-filled
// (#90). A view (e.g. the dashboard bench's "ask" verb or its follow-up input)
// calls requestChatPrompt(text); the shell reveals the panel and drops the text
// into the composer WITHOUT sending it — the user still edits and submits. Same
// monotonic `seq` trick as requestChatSession so an identical prompt re-triggers.
export interface ChatPromptRequest {
  seq: number;
  text: string;
}

const chatPromptRequest = ref<ChatPromptRequest | null>(null);

export const requestChatPrompt = (text: string): void => {
  chatPromptRequest.value = {
    seq: (chatPromptRequest.value?.seq ?? 0) + 1,
    text,
  };
};

export const useChatPromptRequest = (): Readonly<
  Ref<ChatPromptRequest | null>
> => readonly(chatPromptRequest);

// Cross-plugin notification that a plugin view changed the chat-session set
// (deleted / renamed / pinned a session) outside the sidebar store (#59). The
// shell reloads its own session list — and, when the change deleted the session
// it currently has open, reconciles the active chat. `seq` makes repeated changes
// re-trigger; `deletedSessionId` is set only for deletions.
export interface ChatSessionsChange {
  seq: number;
  deletedSessionId?: string;
}

const chatSessionsChanged = ref<ChatSessionsChange | null>(null);

export const notifyChatSessionsChanged = (payload?: {
  deletedSessionId?: string;
}): void => {
  chatSessionsChanged.value = {
    seq: (chatSessionsChanged.value?.seq ?? 0) + 1,
    deletedSessionId: payload?.deletedSessionId,
  };
};

export const useChatSessionsChanged = (): Readonly<
  Ref<ChatSessionsChange | null>
> => readonly(chatSessionsChanged);
