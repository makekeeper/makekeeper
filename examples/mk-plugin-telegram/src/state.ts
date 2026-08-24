import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

// Storage: who is linked to which chat, and the codes that get them there.
//
// A link is keyed by (scopeId, userRef). Neither is a value this plugin
// invents — both arrive on the call context — and together they are the only
// thing that decides where a message goes. There is no lookup by chat id
// alone: that is how a plugin ends up messaging the wrong person after
// somebody forwards a code.

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'telegram.json');

// A pairing code is short because a person retypes it into a chat, and
// short-lived because that is what makes short safe.
const CODE_TTL_MS = 10 * 60_000;

export interface Link {
  scopeId: string;
  userRef: string;
  chatId: number;
  // The language of the person who asked for the code. Messages arrive in a
  // chat, where nothing tells us who is reading — so the locale travels from
  // the screen that started the linking and stays with the link.
  locale: string;
  // Lets a person stop messages from the message itself, without logging in.
  unsubscribeToken: string;
  linkedAt: string;
}

export interface PendingCode {
  code: string;
  scopeId: string;
  userRef: string;
  locale: string;
  expiresAt: number;
}

interface Stored {
  version: 1;
  botToken: string;
  // The bot's @name and this plugin's public URL are part of the SETUP, not of
  // one process's memory: kept in memory only, the linking instructions
  // vanished and messages lost their unsubscribe link after every restart.
  botName: string;
  publicUrl: string;
  links: Link[];
  secret?: string;
  // Event ids already acted on (#194). Delivery is at-least-once and the
  // in-process dedup dies with the process — persisting the ids is what keeps
  // a redelivery after a restart from messaging everyone twice. Bounded: the
  // core stops retrying an acked event, so old ids only guard the retention
  // window, not history.
  seenEventIds?: string[];
}

let state: Stored = {
  version: 1,
  botToken: '',
  botName: '',
  publicUrl: '',
  links: [],
};
// Codes live in memory only: a code that survives a restart is a code that
// outlives the person who asked for it.
let pending: PendingCode[] = [];

export const loadState = async (): Promise<Stored> => {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, 'utf8')) as Stored;
    state = {
      ...stored,
      links: stored.links ?? [],
      botToken: stored.botToken ?? '',
      botName: stored.botName ?? '',
      publicUrl: stored.publicUrl ?? process.env['MK_PLUGIN_PUBLIC_URL'] ?? '',
    };
  } catch {
    state = {
      version: 1,
      botToken: '',
      botName: '',
      publicUrl: process.env['MK_PLUGIN_PUBLIC_URL'] ?? '',
      links: [],
    };
  }
  return state;
};

const save = async (): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
};

const SEEN_EVENTS_CAP = 500;

export const hasSeenEvent = (eventId: string): boolean =>
  (state.seenEventIds ?? []).includes(eventId);

export const markSeenEvent = async (eventId: string): Promise<void> => {
  const seen = state.seenEventIds ?? [];
  seen.push(eventId);
  state.seenEventIds = seen.slice(-SEEN_EVENTS_CAP);
  await save();
};

export const storedSecret = (): string | undefined => state.secret;
export const setSecret = async (secret: string): Promise<void> => {
  state.secret = secret;
  await save();
};

export const botToken = (): string => state.botToken;
export const botName = (): string => state.botName;
export const publicUrl = (): string => state.publicUrl;

// The token and the name that ANSWERED with it are stored together: a name
// without its token names a bot nobody can reach.
export const setBot = async (token: string, name: string): Promise<void> => {
  state.botToken = token;
  state.botName = name;
  await save();
};

export const setPublicUrl = async (url: string): Promise<void> => {
  state.publicUrl = url.trim();
  await save();
};

export const linkOf = (scopeId: string, userRef: string): Link | null =>
  state.links.find((l) => l.scopeId === scopeId && l.userRef === userRef) ??
  null;

// By chat, for the two flows that legitimately start FROM a chat: a code
// arriving in a message, and the unsubscribe link. Never used to answer "who
// is this chat" for anyone else.
export const linkByChat = (chatId: number): Link | null =>
  state.links.find((l) => l.chatId === chatId) ?? null;

export const linkByToken = (token: string): Link | null =>
  token
    ? (state.links.find((l) => l.unsubscribeToken === token) ?? null)
    : null;

export const linksOfScope = (scopeId: string): Link[] =>
  state.links.filter((l) => l.scopeId === scopeId);

// A code is minted per (scope, person) and replaces any earlier one: two live
// codes for the same person are two ways to link the wrong chat.
export const issueCode = (
  scopeId: string,
  userRef: string,
  locale: string,
): string => {
  pending = pending.filter(
    (c) =>
      c.expiresAt > Date.now() &&
      !(c.scopeId === scopeId && c.userRef === userRef),
  );
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(
    6,
    '0',
  );
  pending.push({
    code,
    scopeId,
    userRef,
    locale,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
};

export const pendingCode = (
  scopeId: string,
  userRef: string,
): PendingCode | null =>
  pending.find(
    (c) =>
      c.scopeId === scopeId &&
      c.userRef === userRef &&
      c.expiresAt > Date.now(),
  ) ?? null;

// Redeeming is one-shot and one-way: the code identifies the PERSON, the chat
// comes from the message that carried it, and the code is spent either way.
export const redeemCode = async (
  code: string,
  chatId: number,
): Promise<Link | null> => {
  const found = pending.find(
    (c) => c.code === code && c.expiresAt > Date.now(),
  );
  if (!found) return null;
  pending = pending.filter((c) => c.code !== code);
  const link: Link = {
    scopeId: found.scopeId,
    userRef: found.userRef,
    chatId,
    locale: found.locale,
    unsubscribeToken: randomBytes(24).toString('base64url'),
    linkedAt: new Date().toISOString(),
  };
  state.links = state.links.filter(
    (l) => !(l.scopeId === link.scopeId && l.userRef === link.userRef),
  );
  state.links.push(link);
  await save();
  return link;
};

export const unlink = async (
  scopeId: string,
  userRef: string,
): Promise<boolean> => {
  const before = state.links.length;
  state.links = state.links.filter(
    (l) => !(l.scopeId === scopeId && l.userRef === userRef),
  );
  if (state.links.length === before) return false;
  await save();
  return true;
};

// The unsubscribe link in every message. Token, not ids: the URL is handed to
// a chat client, so it must reveal nothing and authorize exactly one thing.
export const unlinkByToken = async (token: string): Promise<boolean> => {
  const before = state.links.length;
  state.links = state.links.filter((l) => l.unsubscribeToken !== token);
  if (state.links.length === before) return false;
  await save();
  return true;
};

// Uninstall: the plugin is being removed, so nothing it holds should survive
// it (§13). Cheaper and more honest than walking the scopes it happens to
// remember seeing.
export const forgetAll = async (): Promise<void> => {
  state.links = [];
  pending = [];
  await save();
};

export const forgetScope = async (scopeId: string): Promise<number> => {
  const before = state.links.length;
  state.links = state.links.filter((l) => l.scopeId !== scopeId);
  pending = pending.filter((c) => c.scopeId !== scopeId);
  const removed = before - state.links.length;
  if (removed > 0) await save();
  return removed;
};
