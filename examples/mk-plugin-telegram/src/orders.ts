// The first real consumer of a domain event (#194): `logistics.order.received`.
//
// The event is an invitation to re-read, never a state transfer (the core
// repo's docs/external-events.md): the message is built from what the scoped
// surface answers with this plugin's own `logistics:read` grant — an envelope
// field is never quoted to a human. No verified answer, no message.

import { parseObjectRef } from '@makekeeper/plugin-contract';
import type { CoreClient } from '@makekeeper/plugin-sdk';
import type { Link } from './state.ts';

// The slice of a `list_orders` row this plugin reads. The operation returns
// the full order shape; everything else is deliberately not looked at.
interface OrderRow {
  id: string;
  storeName?: string;
}

const isOrderRow = (value: unknown): value is OrderRow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string';

// Returns the store names to announce, one send per linked chat. Exported as a
// pure step (links in, sends out) so the re-read policy is testable without a
// Telegram bot or a core.
export const announceOrderReceived = async (
  core: CoreClient,
  scopeId: string,
  ref: string | undefined,
  links: Link[],
  send: (link: Link, store: string) => Promise<void>,
): Promise<void> => {
  if (links.length === 0) return;
  const entityId = ref ? parseObjectRef(ref)?.entityId : undefined;
  if (!entityId) return;
  let store: string;
  try {
    const rows = await core
      .forScope(scopeId)
      .invoke<unknown[]>('list_orders');
    const order = rows.filter(isOrderRow).find((o) => o.id === entityId);
    // Gone since the event was queued, or the grant went away: nothing
    // verified to say — and an unverifiable notification is worse than none.
    if (!order) return;
    store = order.storeName ?? '';
  } catch (err) {
    console.error('order-received re-read failed', err);
    return;
  }
  for (const link of links) {
    await send(link, store);
  }
};
