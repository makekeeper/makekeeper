// Response shapes of the plugin-chat project AI-history endpoints (#59). Kept in
// step with libs/plugin-chat/src/backend/chat.types.ts — the two plugins share the
// wire contract but not code (no cross-plugin frontend imports; §2).

export interface SessionListItem {
  id: string;
  createdAt: string;
  title: string | null;
  pinned: boolean;
  messageCount: number;
}

export interface PagedSessions {
  items: SessionListItem[];
  total: number;
}

export interface MessageSearchHit {
  sessionId: string;
  messageId: string;
  role: string;
  createdAt: string;
  snippet: string;
  sessionTitle: string | null;
}

export interface MessageSearchResult {
  hits: MessageSearchHit[];
  total: number;
}

export type JournalStatus = 'executed' | 'pending' | 'cancelled';
export type JournalPermission = 'READ' | 'WRITE' | 'DESTRUCTIVE' | 'unknown';

export interface JournalEntry {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  createdAt: string;
  toolName: string;
  permission: JournalPermission;
  status: JournalStatus;
  refs: string[];
}

export interface ProjectJournal {
  entries: JournalEntry[];
  summary: {
    byPermission: {
      READ: number;
      WRITE: number;
      DESTRUCTIVE: number;
      unknown: number;
    };
    affectedRefs: string[];
  };
}

export interface ActivityDay {
  date: string;
  messages: number;
  toolActions: number;
}

export interface UsageDay {
  date: string;
  requests: number;
  tokens: number;
  errors: number;
}

export interface ProjectUsage {
  days: UsageDay[];
  totals: { requests: number; tokens: number; errors: number };
}
