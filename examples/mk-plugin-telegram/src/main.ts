// mk-plugin-telegram — workshop events in your own chat.
//
// The example for notifications that belong to a PERSON in an instance that
// has several. It knows nobody's name: a chat is filed under the opaque
// `userRef` the core puts on every call (contract 1.4), so two people in one
// workspace get their own messages and the plugin cannot tell who either is.
//
// It also carries messages for other plugins, but not by offering them
// anything to call: it declares a DELIVERY CHANNEL (`deliveryChannel` in the
// manifest) and the notification bus hands it what to say. A printer plugin
// posts "your print finished" to the bus and never learns Telegram exists;
// with this plugin uninstalled the same notification simply arrives elsewhere.
// See manifest.ts for why the earlier `telegram.notify` capability was dropped.
//
// Wiring only:
//   manifest.ts   — identity, the channel, the WRITE tool
//   state.ts      — links, codes and unsubscribe tokens
//   sources/bot.ts — long polling and sendMessage
//   screens.ts    — the personal screen and the admin one

import { commands, refresh, startPlugin, toast } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { homeScreen, settingsScreen } from './screens.ts';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';
import { poll, sendMessage, whoAmI } from './sources/bot.ts';
import {
  botName,
  botToken,
  forgetAll,
  forgetScope,
  hasSeenEvent,
  issueCode,
  linkByChat,
  linkByToken,
  linkOf,
  loadState,
  markSeenEvent,
  publicUrl,
  redeemCode,
  setBot,
  setPublicUrl,
  setSecret,
  storedSecret,
  unlink,
  unlinkByToken,
} from './state.ts';

await loadState();

// A chat has no language of its own, so messages are written in the language
// of the person who linked it. Anything sent BEFORE a link exists is English:
// at that point nobody knows who is typing.
const say = (locale: string, key: keyof typeof en): string =>
  (locale.startsWith('ru') ? ru[key] : en[key]) ?? en[key];

// The outcome of the last token check, shown on the settings screen. Only
// this is process-local: the token, the bot's name and the public URL are
// setup and live in storage.
let lastCheck: { ok: boolean; detail?: string; bot?: string } | null = null;

// One message, with the way out attached. Every automated message a person did
// not ask for should carry its own off switch — and this one works from the
// chat itself, without an account or a login.
const deliver = async (
  chatId: number,
  text: string,
  token: string,
): Promise<boolean> => {
  const link = linkByChat(chatId);
  const base = publicUrl();
  const suffix =
    base && link
      ? `\n\n${say(link.locale, 'unsubscribeLine').replace(
          '{url}',
          `${base.replace(/\/+$/, '')}/unsubscribe?t=${link.unsubscribeToken}`,
        )}`
      : '';
  return sendMessage(token, chatId, `${text}${suffix}`);
};

// Where the core lives, for the action links a message carries. The same
// conventional variable the SDK reads for its own client — a plugin that has to
// be told twice where its core is is a plugin somebody will misconfigure.
const coreBaseUrl = (): string =>
  (process.env['MK_CORE_URL'] ?? '').replace(/\/+$/, '');

// Set once startPlugin returns, and used only from the polling loop and the
// public route — both of which run long after boot.
let core: Awaited<ReturnType<typeof startPlugin>>['core'] | null = null;

// The screen showing "your chat is not linked yet" has no way to know that a
// message just arrived in Telegram. This is the nudge: the core relays it over
// its own socket and the open screen refetches, so linking finishes where the
// person is looking rather than on their next reload.
const nudge = async (scopeId: string): Promise<void> => {
  await core
    ?.forScope(scopeId)
    .notifyChanged('home')
    .catch(() => undefined);
};

const plugin = await startPlugin({
  manifest,
  pluginSecret: storedSecret(),
  onSecretIssued: setSecret,
  onSecretForgotten: async () => setSecret(''),
  // A message is an outward act: redelivery after a restart must not repeat
  // it, so the dedup survives the process (SDK rule 4 in CLAUDE.md).
  eventDedup: { has: hasSeenEvent, add: markSeenEvent },

  // The one route the core does not sign, because the caller is a person in a
  // chat client clicking a link — they cannot produce the core's signature and
  // must not need an account here.
  publicRoutes: {
    '/unsubscribe': async (req) => {
      const token = req.query.get('t') ?? '';
      // Read the link BEFORE removing it — afterwards there is nothing left to
      // ask, neither its language nor whose screen to refresh.
      const existing = linkByToken(token);
      const locale = existing?.locale ?? 'en';
      const done = await unlinkByToken(token);
      if (done && existing) await nudge(existing.scopeId);
      return {
        status: done ? 200 : 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: done ? say(locale, 'unsubscribedPage') : en.unsubscribeUnknown,
      };
    },
  },

  handlers: {
    render: async ({ screen, context }) => {
      if (screen === 'settings') return settingsScreen(lastCheck, publicUrl());
      return homeScreen(context.scopeId, context.userRef, botName());
    },

    action: async ({ action, form, context }) => {
      if (action === 'checkBot') {
        // A blank secret field means "keep the stored one" — the token is
        // never rendered back, so an empty submit cannot mean "erase".
        const typed =
          typeof form?.['token'] === 'string' ? form['token'].trim() : '';
        const token = typed || botToken();
        if (typeof form?.['publicUrl'] === 'string') {
          await setPublicUrl(form['publicUrl']);
        }
        if (!token) {
          lastCheck = { ok: false };
          return commands(refresh());
        }
        try {
          const name = await whoAmI(token);
          // Only a token that ANSWERED is stored, together with the name it
          // answered under: checking one and keeping another is the trap this
          // whole flow exists to avoid.
          await setBot(token, name);
          lastCheck = { ok: true, bot: name };
          startPolling();
        } catch (err: unknown) {
          lastCheck = {
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
          };
        }
        return commands(refresh());
      }

      const { scopeId, userRef } = context;
      if (!userRef) return commands(toast('error', 'anonymous'));

      if (action === 'code') {
        issueCode(scopeId, userRef, context.locale);
        return commands(refresh());
      }

      if (action === 'test') {
        const link = linkOf(scopeId, userRef);
        if (!link) return commands(toast('error', 'notLinked'));
        const ok = await deliver(
          link.chatId,
          say(link.locale, 'testMessage'),
          botToken(),
        );
        // No detail to give here — sendMessage either went or did not — so the
        // message that has a {detail} placeholder is not the one to use.
        return ok
          ? commands(toast('success', 'testSent'))
          : commands(toast('error', 'testRefused'));
      }

      if (action === 'unlink') {
        await unlink(scopeId, userRef);
        return commands(refresh({ tone: 'success', key: 'unlinked' }));
      }

      return commands();
    },

    // The channel contract (#312). The core hands over a message it has
    // already rendered in the reader's own language, together with the opaque
    // ref of the person to reach — this plugin formats and sends, and decides
    // nothing about who hears what.
    capability: async ({ method, args, context }) => {
      const [input] = args as [Record<string, unknown> | undefined];
      const userRef = String(input?.['userRef'] ?? '');
      const link = userRef ? linkOf(context.scopeId, userRef) : null;

      // Asked before anything is queued, so the core never fills a delivery log
      // with failures for a channel nobody connected.
      if (method === 'isLinked') return link !== null;

      if (method !== 'deliver') return null;
      // THROWING is how a channel reports failure: the core retries with
      // backoff and eventually shows the delivery as dead. Returning a quiet
      // "false" would turn "Telegram is down" into "the person was told".
      if (!link) throw new Error('no chat linked for this person');
      const title = String(input?.['title'] ?? '');
      const body = String(input?.['body'] ?? '');
      const url = typeof input?.['url'] === 'string' ? input['url'] : '';
      const actions = Array.isArray(input?.['actions'])
        ? (input['actions'] as { label?: unknown; token?: unknown }[])
        : [];
      const lines = [title, body].filter((line) => line.length > 0);
      if (url) lines.push(url);
      // Each action carries a single-use token; pressing one is a POST back to
      // the core, so this plugin never holds authority of its own. Rendered as
      // links rather than inline keyboards to keep the example one file
      // shorter than the point it is making.
      for (const action of actions) {
        const token = String(action.token ?? '');
        const label = String(action.label ?? '');
        const base = coreBaseUrl();
        if (token && label && base) {
          lines.push(`${label}: ${base}/api/notifications/action/${token}`);
        }
      }
      const sent = await deliver(link.chatId, lines.join('\n'), botToken());
      if (!sent) throw new Error('telegram refused the message');
      return true;
    },

    tool: async ({ args, context }) => {
      const text = String((args as { text?: unknown }).text ?? '').trim();
      const link = context.userRef
        ? linkOf(context.scopeId, context.userRef)
        : null;
      if (!link || !text) return { sent: false, reason: 'toolNotLinked' };
      return { sent: await deliver(link.chatId, text, botToken()) };
    },

    // Only housekeeping is left: when a workspace goes, its chat links go with
    // it. What is worth telling a person is the bus's decision now.
    onEvent: async ({ event }) => {
      if (event.type === 'core.scope-deleted' && event.scopeId) {
        await forgetScope(event.scopeId);
      }
    },

    purge: async () => {
      await forgetAll();
    },
  },
});

core = plugin.core;

// Long polling: one open connection to Telegram, restarted on error with a
// pause so a wrong token does not turn into a request loop.
let polling = false;
const startPolling = (): void => {
  if (polling || !botToken()) return;
  polling = true;
  void (async () => {
    let offset = 0;
    for (;;) {
      const token = botToken();
      if (!token) {
        polling = false;
        return;
      }
      try {
        const batch = await poll(token, offset);
        offset = batch.nextOffset;
        for (const update of batch.updates) {
          // A bot that answers nothing looks like a bot that is broken. Every
          // message gets a reply: the code links, anything else is told what
          // to send. `/start` is what a person sends first, and it used to be
          // met with silence.
          const code = update.text.trim().replace(/^\/link\s+/, '');
          if (!/^\d{6}$/.test(code)) {
            await sendMessage(token, update.chatId, en.botHelp);
            continue;
          }
          const link = await redeemCode(code, update.chatId);
          if (link) {
            await deliver(update.chatId, say(link.locale, 'botLinked'), token);
            // The screen that issued this code is very likely still open.
            await nudge(link.scopeId);
          } else {
            await sendMessage(token, update.chatId, en.botBadCode);
          }
        }
      } catch {
        // Telegram down, token wrong, network gone: all the same answer —
        // wait, then try again. The plugin stays useful for everything else.
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    }
  })();
};

startPolling();
