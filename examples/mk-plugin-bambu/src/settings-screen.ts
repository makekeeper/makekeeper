// The settings screen: where the printer's address and credentials are typed.
//
// Three rules this screen demonstrates, all worth copying:
//   * a stored SECRET is never rendered back — the field is empty, its
//     placeholder says whether one is stored, and a blank submit keeps it;
//   * the form shows only what the CHOSEN source needs, so an admin using
//     Home Assistant is not asked for a printer access code;
//   * anything the plugin can look up, it looks up. A Home Assistant install
//     has hundreds of entities and this plugin needs six; asking a human to
//     transcribe them is work the plugin can do with one HTTP call.

import {
  screen,
  paragraph,
  heading,
  divider,
  form,
  callout,
} from '@makekeeper/plugin-sdk';
import type { UiFormField, UiNode, UiScreen } from '@makekeeper/plugin-contract';
import { isComplete, type Config } from './config.ts';
import {
  HA_METRIC_NAMES,
  detectPrinters,
  entitiesOf,
  printerOfMapping,
  suggestMapping,
  type HaMetric,
} from './sources/ha-discovery.ts';

type Field = Omit<UiFormField, 'label'> & { labelKey: string };
type Pending = Record<string, string | number | boolean> | undefined;

export interface Discovery {
  entities: string[];
  check: { ok: boolean; detail?: string; at: string } | null;
}

const METRIC_LABELS: Record<HaMetric, string> = {
  haEntityState: 'fieldHaState',
  haEntityProgress: 'fieldHaProgress',
  haEntityRemaining: 'fieldHaRemaining',
  haEntityNozzle: 'fieldHaNozzle',
  haEntityBed: 'fieldHaBed',
  haEntityJob: 'fieldHaJob',
};

const lanFields = (config: Config): Field[] => [
  { name: 'host', type: 'text', labelKey: 'fieldHost', value: config.host, width: 'half' },
  { name: 'serial', type: 'text', labelKey: 'fieldSerial', value: config.serial, width: 'half' },
  {
    name: 'accessCode',
    // Contract 1.1: masked. On an older core the node is skipped rather than
    // rendered in clear — which is the point of "skip unknown".
    type: 'password',
    labelKey: 'fieldAccessCode',
    width: 'half',
    placeholderKey: config.accessCode ? 'secretSet' : 'secretUnset',
  },
];

const credentialFields = (config: Config, pending: Pending): Field[] => [
  {
    name: 'haUrl',
    type: 'text',
    labelKey: 'fieldHaUrl',
    // The address and its token are one credential, so they sit on one row.
    width: 'half',
    // What the user typed wins over what is stored: the check runs against the
    // typed value, so the field must keep showing it after the redraw.
    value: String(pending?.['haUrl'] ?? config.haUrl),
  },
  {
    name: 'haToken',
    type: 'password',
    labelKey: 'fieldHaToken',
    width: 'half',
    placeholderKey: config.haToken ? 'secretSet' : 'secretUnset',
  },
];

// Before anything is discovered — and on a core too old to send the form along
// with a button — the ids stay typeable. A dropdown that cannot be populated
// must not become a dead end.
const manualEntityFields = (config: Config): Field[] =>
  HA_METRIC_NAMES.map((metric) => ({
    name: metric,
    type: 'text',
    labelKey: METRIC_LABELS[metric],
    value: config[metric],
    width: 'half',
  }));

// After a successful check: one dropdown per metric, listing that printer's
// entities. The plugin proposes, the admin disposes.
const discoveredEntityFields = (
  config: Config,
  pending: Pending,
  entities: string[],
): Field[] => {
  const printers = detectPrinters(entities);
  // Which printer is being configured: the pending pick, else the one the
  // stored mapping belongs to, else the first one found.
  const configured = printerOfMapping(config.haEntityState);
  const chosen = String(
    pending?.['haPrinter'] ?? (configured || printers[0] || ''),
  );
  const own = entitiesOf(entities, chosen);
  const suggestion = suggestMapping(entities, chosen);

  const valueFor = (metric: HaMetric): string => {
    // A value only survives while it still belongs to the chosen printer —
    // switching printers must not leave a field pointing at the old one.
    const belongs = (id: unknown): id is string =>
      typeof id === 'string' && id.startsWith(`${chosen}_`);
    const typed = pending?.[metric];
    if (belongs(typed)) return typed;
    if (belongs(config[metric])) return config[metric];
    return suggestion[metric];
  };

  const options = [
    // An entity is optional: without it the card simply omits that number.
    { value: '', label: { key: 'entityNone' } },
    // An entity id is an identifier, not prose — it travels as a parameter of
    // a passthrough key rather than as a literal label.
    ...own.map((id) => ({ value: id, label: { key: 'entityId', params: { id } } })),
  ];

  return [
    {
      name: 'haPrinter',
      type: 'select',
      labelKey: 'fieldHaPrinter',
      value: chosen,
      // Picking a different printer re-proposes all six entities.
      reloadOnChange: true,
      options: printers.map((prefix) => ({
        value: prefix,
        label: { key: 'entityId', params: { id: prefix } },
      })),
    },
    ...HA_METRIC_NAMES.map<Field>((metric) => ({
      name: metric,
      type: 'select',
      labelKey: METRIC_LABELS[metric],
      value: valueFor(metric),
      width: 'half',
      options,
    })),
  ];
};

// What the last connection check found, in the plugin's own words. A failed
// check says why — a 401 is a bad token, a refused connection is the wrong
// host — because "could not connect" sends people to the wrong place.
const checkResult = (discovery: Discovery | undefined): UiNode[] => {
  const check = discovery?.check ?? null;
  const entities = discovery?.entities ?? [];
  if (!check) return [callout('checkHint', 'neutral')];
  if (!check.ok) {
    // No detail means the check never left the plugin: url or token missing.
    // With one, it is the transport's own word — an HTTP status, a refused
    // connection — which is exactly what tells the admin where to look.
    return check.detail
      ? [callout('checkFailed', 'danger', { detail: check.detail })]
      : [callout('checkNoCredentials', 'warning')];
  }
  return [
    callout('checkOk', 'success', {
      entities: entities.length,
      printers: detectPrinters(entities).length,
    }),
  ];
};

// `pending` is what the user has typed but not yet saved. The source selector
// declares `reloadOnChange`, so picking Home Assistant redraws this screen
// with the Home Assistant fields immediately — before that, the form asked for
// printer credentials no matter which source you chose, which is a
// questionnaire rather than a form.
//
// Home Assistant gets TWO forms, in the order the work actually happens:
// credentials, then the check that proves them, then everything the check made
// available. One form with the check button underneath would have put the
// button after the six entity fields it is supposed to populate.
export const settingsScreen = (
  config: Config,
  pending?: Record<string, string | number | boolean>,
  discovery?: Discovery,
): UiScreen => {
  const chosen = String(pending?.['source'] ?? config.source);
  const entities = discovery?.entities ?? [];

  const sourceField: Field = {
    name: 'source',
    type: 'select',
    labelKey: 'fieldSource',
    value: chosen,
    // The one field whose change redraws the screen.
    reloadOnChange: true,
    options: [
      { value: 'lan', label: { key: 'sourceLan' } },
      { value: 'ha', label: { key: 'sourceHa' } },
      { value: 'none', label: { key: 'sourceNone' } },
    ],
  };

  // Home Assistant: credentials and their check first, entities second.
  const haNodes = [
    form({
      fields: [sourceField, ...credentialFields(config, pending)],
      // The submit IS the check: it verifies the pair and, on success, keeps
      // it. A separate "save" here would offer to store credentials nobody
      // had tested.
      submitKey: 'checkConnection',
      onSubmit: { action: 'checkHa' },
    }),
    ...checkResult(discovery),
    form({
      fields:
        entities.length > 0
          ? discoveredEntityFields(config, pending, entities)
          : manualEntityFields(config),
      submitKey: 'save',
      onSubmit: { action: 'saveSettings' },
    }),
  ];

  // Everything else is one form: there is nothing to check first.
  const plainNodes = [
    form({
      fields: [sourceField, ...(chosen === 'lan' ? lanFields(config) : [])],
      submitKey: 'save',
      onSubmit: { action: 'saveSettings' },
    }),
  ];

  return screen('settingsTitle', [
    paragraph('settingsIntro', { variant: 'muted' }),
    isComplete(config)
      ? paragraph('whereToFind', { variant: 'muted' })
      : callout('incomplete', 'warning'),
    ...(chosen === 'lan' ? [callout('lanNote', 'neutral')] : []),
    divider(),
    heading('fieldSource'),
    ...(chosen === 'ha' ? haNodes : plainNodes),
  ]);
};
