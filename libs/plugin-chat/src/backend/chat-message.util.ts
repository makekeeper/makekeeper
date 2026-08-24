import { AIChatMessage } from '@prisma/client';
import { StoredMessagePayload } from './chat.types';

// Pure helpers over a stored chat message's `content`, shared by ChatService
// (the agent runtime) and ChatAnalyticsService (reporting). A message's content
// is either a human's plain text or a JSON-encoded StoredMessagePayload
// (tool_call / tool_response / …); these tell the two apart without either
// service reaching into the other.

// Parse a message's content as a StoredMessagePayload, or null when it is plain
// human text (or malformed JSON).
export function parseMessagePayload(
  content: string,
): StoredMessagePayload | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as StoredMessagePayload)
      : null;
  } catch {
    return null;
  }
}

// True when the content is a human's plain text rather than an encoded agent
// payload (which always carries a `type` discriminant).
export function isHumanText(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return !(typeof parsed === 'object' && parsed !== null && 'type' in parsed);
  } catch {
    return true;
  }
}

// Derive a session title from its first human message (trimmed to 60 chars), or
// null when the session has no human text yet. Takes the two fields it reads
// rather than whole rows, so the session list can select those two columns
// instead of loading every message in full to name a chat.
export function deriveSessionTitle(
  messages: readonly Pick<AIChatMessage, 'role' | 'content'>[],
): string | null {
  const firstHuman = messages.find(
    (m) => m.role === 'user' && isHumanText(m.content),
  );
  if (!firstHuman) return null;
  const text = firstHuman.content.trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
