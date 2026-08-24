import assert from 'node:assert/strict';
import test from 'node:test';
import type { UiNode, UiScreen, UiText } from '@makekeeper/plugin-contract';
import { en } from './en.ts';
import { ru } from './ru.ts';
import { homeScreen, asideScreen } from '../screens.ts';
import { addNote, forgetScope, loadState } from '../state.ts';

// A key that takes a parameter must be GIVEN one.
//
// This is the guard the printer example needed before it shipped a callout
// reading "Not connected ()" — a message whose parameter nobody passed.
//
// This walks every screen this plugin can produce and checks the two
// directions that matter: no placeholder without a value, and no value for a
// placeholder that does not exist (a renamed key leaving a caller behind).

const placeholders = (value: string): Set<string> =>
  new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));

// Only i18n references are checked. A raw string in a value slot is DATA (a
// job name, a temperature) and belongs to the plugin — except when it looks
// like one of our own keys, which is the mistake this also catches: a key
// passed where a value was expected renders the key itself.
const texts = (nodes: UiNode[]): UiText[] => {
  const found: UiText[] = [];
  const push = (value: UiText | string | undefined): void => {
    if (value && typeof value === 'object') found.push(value);
  };
  const walk = (list: UiNode[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'text':
        case 'badge':
        case 'callout':
          push(node.text);
          break;
        case 'stat':
          push(node.label);
          push(node.unit);
          break;
        case 'button':
          push(node.label);
          break;
        case 'detail':
          for (const row of node.rows) {
            push(row.label);
            push(row.value);
          }
          break;
        case 'table':
          for (const col of node.columns) push(col.label);
          push(node.empty);
          for (const row of node.rows) {
            for (const cell of Object.values(row.cells)) {
              push(cell.text);
              push(cell.badge?.text);
            }
          }
          break;
        case 'list':
          push(node.empty);
          for (const item of node.items) {
            push(item.title);
            push(item.subtitle);
            push(item.badge?.text);
          }
          break;
        case 'form':
          for (const field of node.fields) {
            push(field.label);
            for (const option of field.options ?? []) push(option.label);
          }
          push(node.submit.label);
          break;
        case 'section':
          push(node.title);
          walk(node.children);
          break;
        default:
          break;
      }
    }
  };
  walk(nodes);
  return found;
};

process.env['MK_STATE_DIR'] = process.env['MK_STATE_DIR'] ?? '/tmp/mk-notes-ph';

await loadState();
await forgetScope('scope-a');
await addNote({
  scopeId: 'scope-a',
  userRef: 'anna',
  entityRef: 'mk://inventory/item/1',
  text: 'a note',
});

// Every shape a reader can land on, including the ones that only appear when
// something is missing — those are the ones nobody looks at twice.
const SCREENS = (): UiScreen[] => [
  homeScreen('scope-a', 'anna', { page: 0, sort: 'written', direction: 'desc' }),
  // The editing state of both screens — a form filled in, and a cancel button.
  homeScreen('scope-a', 'anna', {
    page: 0,
    sort: 'written',
    direction: 'desc',
    editing: 'missing-id',
  }),
  homeScreen('scope-a', 'anna', { page: 1, sort: 'note', direction: 'asc' }),
  homeScreen('scope-a', undefined, { page: 0, sort: 'written', direction: 'desc' }),
  asideScreen('scope-a', 'anna', 'mk://inventory/item/1'),
  asideScreen('scope-a', 'anna', 'mk://inventory/item/1', 0, 'missing-id'),
  asideScreen('scope-a', 'anna', 'mk://inventory/item/2'),
  asideScreen('scope-a', 'anna', ''),
  asideScreen('scope-a', undefined, 'mk://inventory/item/1'),
];

test('every parameter a string expects is passed, and no more', () => {
  for (const screen of SCREENS()) {
    for (const value of [screen.title, ...texts(screen.children)]) {
      const template = (en as Record<string, string>)[value.key];
      assert.ok(template !== undefined, `missing en key: ${value.key}`);
      const expected = placeholders(template);
      const given = new Set(Object.keys(value.params ?? {}));
      for (const name of expected) {
        assert.ok(given.has(name), `${value.key} needs {${name}} and got none`);
      }
      for (const name of given) {
        assert.ok(expected.has(name), `${value.key} was given {${name}} it does not use`);
      }
    }
  }
});

// The other half of the same trap: `detail` and table cells accept a plain
// string, so an i18n KEY handed to one renders verbatim — "stateIdle" where
// the user expects "Idle".
const rawStrings = (nodes: UiNode[]): string[] => {
  const found: string[] = [];
  const walk = (list: UiNode[]): void => {
    for (const node of list) {
      if (node.type === 'detail') {
        for (const row of node.rows) {
          if (typeof row.value === 'string') found.push(row.value);
        }
      } else if (node.type === 'table') {
        for (const row of node.rows) {
          for (const cell of Object.values(row.cells)) {
            if (typeof cell.text === 'string') found.push(cell.text);
          }
        }
      } else if (node.type === 'section') {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return found;
};

test('no i18n key is passed where a value is expected', () => {
  for (const screen of SCREENS()) {
    for (const value of rawStrings(screen.children)) {
      assert.ok(
        !(value in (en as Record<string, string>)),
        `"${value}" is one of our keys, rendered as text`,
      );
    }
  }
});

test('both locales declare the same placeholders', () => {
  for (const [key, value] of Object.entries(en as Record<string, string>)) {
    const other = (ru as Record<string, string>)[key];
    assert.ok(other !== undefined, `missing ru key: ${key}`);
    assert.deepEqual(
      [...placeholders(other)].sort(),
      [...placeholders(value)].sort(),
      `placeholders differ for ${key}`,
    );
  }
});

// vue-i18n reads `@` as its linked-message syntax, so `@{name}` stops the
// interpolation and the placeholder renders literally. It cost one round of
// "Connected as @{bot}." on a real screen; the at-sign belongs in the VALUE.
test('no message uses the linked-message syntax by accident', () => {
  for (const [locale, bundle] of [['en', en], ['ru', ru]] as const) {
    for (const [key, value] of Object.entries(bundle as Record<string, string>)) {
      assert.ok(
        !/@[:{.]/.test(value),
        `${locale}.${key} contains "@" before a placeholder or key`,
      );
    }
  }
});
