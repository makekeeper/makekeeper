import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forgetScope,
  issueCode,
  linkByChat,
  linkOf,
  loadState,
  pendingCode,
  redeemCode,
  unlink,
  unlinkByToken,
} from './state.ts';

// Linking is the only place this plugin can send a message to the wrong
// person, so it is the part with tests.

process.env['MK_STATE_DIR'] = process.env['MK_STATE_DIR'] ?? '/tmp/mk-telegram-test';

const fresh = async (): Promise<void> => {
  await loadState();
  await forgetScope('scope-a');
  await forgetScope('scope-b');
};

test('a code links the person who asked for it, to the chat that sent it', async () => {
  await fresh();
  const code = issueCode('scope-a', 'anna', 'en');
  const link = await redeemCode(code, 111);
  assert.equal(link?.userRef, 'anna');
  assert.equal(linkOf('scope-a', 'anna')?.chatId, 111);
});

test('a code is one-shot — a forwarded one links nobody twice', async () => {
  await fresh();
  const code = issueCode('scope-a', 'anna', 'en');
  assert.ok(await redeemCode(code, 111));
  assert.equal(await redeemCode(code, 222), null);
  // And the first chat keeps the link rather than being replaced by whoever
  // pasted the code second.
  assert.equal(linkOf('scope-a', 'anna')?.chatId, 111);
});

test('asking again replaces the earlier code', async () => {
  await fresh();
  const first = issueCode('scope-a', 'anna', 'en');
  const second = issueCode('scope-a', 'anna', 'en');
  assert.notEqual(first, second);
  assert.equal(pendingCode('scope-a', 'anna')?.code, second);
  assert.equal(await redeemCode(first, 111), null);
});

test('relinking moves the person, it does not accumulate chats', async () => {
  await fresh();
  await redeemCode(issueCode('scope-a', 'anna', 'en'), 111);
  await redeemCode(issueCode('scope-a', 'anna', 'en'), 222);
  assert.equal(linkOf('scope-a', 'anna')?.chatId, 222);
  assert.equal(linkByChat(111), null);
});

test('the unsubscribe token stops exactly one chat', async () => {
  await fresh();
  const anna = await redeemCode(issueCode('scope-a', 'anna', 'en'), 111);
  await redeemCode(issueCode('scope-a', 'boris', 'en'), 222);
  assert.equal(await unlinkByToken(anna!.unsubscribeToken), true);
  assert.equal(linkOf('scope-a', 'anna'), null);
  assert.equal(linkOf('scope-a', 'boris')?.chatId, 222);
  // A stale link cannot be used a second time.
  assert.equal(await unlinkByToken(anna!.unsubscribeToken), false);
});

test('people in different workspaces do not share a link', async () => {
  await fresh();
  await redeemCode(issueCode('scope-a', 'anna', 'en'), 111);
  assert.equal(linkOf('scope-b', 'anna'), null);
  await unlink('scope-a', 'anna');
});

test('a deleted workspace takes its links with it', async () => {
  await fresh();
  await redeemCode(issueCode('scope-a', 'anna', 'en'), 111);
  await redeemCode(issueCode('scope-b', 'anna', 'en'), 222);
  assert.equal(await forgetScope('scope-a'), 1);
  assert.equal(linkOf('scope-b', 'anna')?.chatId, 222);
});
