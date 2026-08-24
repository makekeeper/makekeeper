// The Telegram side: long polling and one sendMessage.
//
// Long polling, not a webhook, on purpose. A webhook needs this container to
// be reachable from the public internet, which a workshop's plugin container
// generally is not — and telling people to expose it would be worse advice
// than the extra HTTP connection this costs.

const API = 'https://api.telegram.org';
// Telegram holds the request open; this is the wait it is told to use, not a
// poll interval, so an idle bot costs one connection and no traffic.
const LONG_POLL_S = 30;

export interface Update {
  updateId: number;
  chatId: number;
  text: string;
}

const url = (token: string, method: string): string =>
  `${API}/bot${token}/${method}`;

export const sendMessage = async (
  token: string,
  chatId: number,
  text: string,
): Promise<boolean> => {
  const res = await fetch(url(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return res.ok;
};

// One poll. Returns the updates and the offset to ask from next time —
// acknowledging by offset is what stops Telegram replaying them forever.
export const poll = async (
  token: string,
  offset: number,
): Promise<{ updates: Update[]; nextOffset: number }> => {
  const res = await fetch(
    `${url(token, 'getUpdates')}?timeout=${LONG_POLL_S}&offset=${offset}`,
    { signal: AbortSignal.timeout((LONG_POLL_S + 10) * 1000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as {
    ok?: boolean;
    result?: Array<{
      update_id?: number;
      message?: { chat?: { id?: number }; text?: string };
    }>;
  };
  if (!payload.ok || !Array.isArray(payload.result)) {
    throw new Error('unexpected response');
  }
  const updates: Update[] = [];
  let nextOffset = offset;
  for (const row of payload.result) {
    const updateId = row.update_id;
    if (typeof updateId !== 'number') continue;
    nextOffset = Math.max(nextOffset, updateId + 1);
    const chatId = row.message?.chat?.id;
    const text = row.message?.text;
    if (typeof chatId === 'number' && typeof text === 'string') {
      updates.push({ updateId, chatId, text });
    }
  }
  return { updates, nextOffset };
};

// Whether the token is a token at all, and who it belongs to — the check
// behind the settings screen's button.
export const whoAmI = async (token: string): Promise<string> => {
  const res = await fetch(url(token, 'getMe'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as { ok?: boolean; result?: { username?: string } };
  if (!payload.ok || !payload.result?.username) throw new Error('unexpected response');
  return payload.result.username;
};
