import {
  screen,
  paragraph,
  callout,
  divider,
  stat,
  button,
  form,
} from '@makekeeper/plugin-sdk';
import type { UiNode, UiScreen } from '@makekeeper/plugin-contract';
import { botToken, linkOf, linksOfScope, pendingCode, type Link } from './state.ts';

const minutesSince = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

const linkedLine = (link: Link): UiNode => {
  const minutes = minutesSince(link.linkedAt);
  return minutes < 1
    ? paragraph('linkedJustNow', { variant: 'muted' })
    : paragraph('linkedAgo', { params: { minutes }, variant: 'muted' });
};

// The personal screen. Everything on it is about ONE person's chat — the
// caller's — and the plugin knows which person only as an opaque reference.
export const homeScreen = (
  scopeId: string,
  userRef: string | undefined,
  botName: string,
): UiScreen => {
  if (!botToken()) return screen('title', [callout('notConfigured', 'warning')]);
  // No caller, no chat: a background call must not be shown, or able to change,
  // anybody's link.
  if (!userRef) return screen('title', [callout('anonymous', 'neutral')]);

  const link = linkOf(scopeId, userRef);
  if (link) {
    return screen('title', [
      paragraph('intro', { variant: 'muted' }),
      callout('linked', 'success'),
      linkedLine(link),
      button('sendTest', { action: 'test' }, { variant: 'secondary' }),
      divider(),
      button('unlink', { action: 'unlink' }, { variant: 'danger' }),
      // How many other people in this workspace get messages — a count, never
      // a list: who else is linked is nobody's business but theirs.
      paragraph('linkedChats', {
        params: { count: linksOfScope(scopeId).length },
        variant: 'muted',
      }),
    ]);
  }

  const code = pendingCode(scopeId, userRef);
  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    callout('notLinked', 'neutral'),
    // The at-sign travels in the VALUE, not in the message: vue-i18n reads
    // `@` before a placeholder as its linked-message syntax and stops
    // interpolating, so "@{bot}" rendered literally.
    ...(botName ? [paragraph('howTo', { params: { bot: `@${botName}` } })] : []),
    ...(code
      ? [
          stat('codeLabel', code.code),
          paragraph('codeValid', { variant: 'muted' }),
        ]
      : []),
    button('getCode', { action: 'code' }),
  ]);
};

// The admin screen: one bot for the whole instance. It lives in the plugin's
// card in Settings -> External plugins, which is why it says nothing about
// individual chats.
export const settingsScreen = (
  check: { ok: boolean; detail?: string; bot?: string } | null,
  publicUrl: string,
): UiScreen =>
  screen('settingsTitle', [
    paragraph('settingsIntro', { variant: 'muted' }),
    form({
      fields: [
        {
          name: 'token',
          type: 'password',
          labelKey: 'fieldToken',
          width: 'half',
          placeholderKey: botToken() ? 'tokenSet' : 'tokenUnset',
          // Contract 1.6: the explanation belongs UNDER ITS FIELD. As a
          // paragraph beside the form it read as orphan text about nothing in
          // particular — which is exactly how it was reported.
          hintKey: 'tokenHint',
        },
        {
          name: 'publicUrl',
          type: 'text',
          labelKey: 'fieldPublicUrl',
          width: 'half',
          value: publicUrl,
          hintKey: 'publicUrlHint',
        },
      ],
      submitKey: 'checkBot',
      onSubmit: { action: 'checkBot' },
    }),
    ...checkResult(check),
  ]);

const checkResult = (
  check: { ok: boolean; detail?: string; bot?: string } | null,
): UiNode[] => {
  if (!check) return [];
  if (check.ok) {
    return [callout('checkOk', 'success', { bot: check.bot ? `@${check.bot}` : '' })];
  }
  return check.detail
    ? [callout('checkFailed', 'danger', { detail: check.detail })]
    : [callout('checkNoToken', 'warning')];
};
