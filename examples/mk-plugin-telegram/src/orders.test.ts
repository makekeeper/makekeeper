import assert from 'node:assert/strict';
import test from 'node:test';
import { announceOrderReceived } from './orders.ts';
import type { CoreClient } from '@makekeeper/plugin-sdk';
import type { Link } from './state.ts';

// The re-read policy: what the handler quotes comes from the scoped surface,
// never from the envelope — and when nothing can be verified, nobody is
// messaged.

const link = (chatId: number): Link => ({
  scopeId: 's1',
  userRef: `u${chatId}`,
  chatId,
  locale: 'en',
  linkedAt: '2026-01-01T00:00:00.000Z',
  unsubscribeToken: 't',
});

const coreWith = (orders: unknown[] | Error): CoreClient =>
  ({
    forScope: () => ({
      invoke: async () => {
        if (orders instanceof Error) throw orders;
        return orders;
      },
    }),
  }) as unknown as CoreClient;

const REF = 'mk://logistics/order/ord_1';

test('messages every linked chat with the re-read store name', async () => {
  const sent: Array<{ chatId: number; store: string }> = [];
  await announceOrderReceived(
    coreWith([{ id: 'ord_1', storeName: 'shop' }]),
    's1',
    REF,
    [link(1), link(2)],
    async (l, store) => {
      sent.push({ chatId: l.chatId, store });
    },
  );
  assert.deepEqual(sent, [
    { chatId: 1, store: 'shop' },
    { chatId: 2, store: 'shop' },
  ]);
});

test('stays silent when the order cannot be re-read', async () => {
  const sent: unknown[] = [];
  const push = async (): Promise<void> => {
    sent.push(1);
  };
  // Order gone from the answer.
  await announceOrderReceived(coreWith([]), 's1', REF, [link(1)], push);
  // Grant revoked / core unreachable.
  await announceOrderReceived(
    coreWith(new Error('403')),
    's1',
    REF,
    [link(1)],
    push,
  );
  // No usable ref on the envelope.
  await announceOrderReceived(
    coreWith([{ id: 'ord_1' }]),
    's1',
    undefined,
    [link(1)],
    push,
  );
  assert.equal(sent.length, 0);
});

test('does nothing at all for a scope with no linked chats', async () => {
  let reads = 0;
  const core = {
    forScope: () => ({
      invoke: async () => {
        reads += 1;
        return [];
      },
    }),
  } as unknown as CoreClient;
  await announceOrderReceived(core, 's1', REF, [], async () => undefined);
  assert.equal(reads, 0);
});
