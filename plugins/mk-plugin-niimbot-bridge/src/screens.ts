import {
  button,
  callout,
  detail,
  divider,
  form,
  heading,
  list,
  paragraph,
  screen,
  text,
} from '@makekeeper/plugin-sdk';
import type { UiScreen } from '@makekeeper/plugin-contract';
import type { ScannedPrinter } from './transport.ts';
import { DENSITY_MAX, DENSITY_MIN, LABEL_TYPES, type State } from './state.ts';

// The bridge's settings screen — pure, state in and a tree out, so it reads on
// its own and can be checked without a core.
//
// What an operator needs here is the #151 shape: find the printer, say what is
// loaded in it, and prove the link works before anybody prints a real label.

const labelTypeOptionKey = {
  withGaps: 'labelTypeWithGaps',
  black: 'labelTypeBlack',
  transparent: 'labelTypeTransparent',
} as const;

export const settingsScreen = (
  state: State,
  found: ScannedPrinter[],
  queueDepth: number,
): UiScreen =>
  screen('settingsTitle', [
    paragraph('intro', { variant: 'muted' }),
    detail([
      {
        labelKey: 'statePrinter',
        value: state.address === '' ? text('stateNone') : state.address,
      },
      { labelKey: 'stateDensity', value: String(state.density) },
      {
        labelKey: 'stateLabelType',
        value: text(labelTypeOptionKey[state.labelType]),
      },
      { labelKey: 'stateQueue', value: String(queueDepth) },
    ]),
    divider(),

    heading('scanSection'),
    paragraph('scanHint', { variant: 'muted' }),
    button('scan', { action: 'scan' }, { variant: 'secondary' }),
    // Only after a scan: an empty list on arrival would read as "no printer
    // exists", when nothing has looked yet.
    ...(found.length > 0
      ? [
          list({
            items: found.map((device) => ({
              title: device.name,
              subtitle: device.address,
              action: {
                label: text('choose'),
                onClick: {
                  action: 'choose',
                  params: { address: device.address },
                },
              },
            })),
            emptyKey: 'scanEmpty',
          }),
        ]
      : []),
    divider(),

    heading('settingsSection'),
    form({
      fields: [
        {
          name: 'address',
          type: 'text',
          labelKey: 'fieldAddress',
          hintKey: 'fieldAddressHint',
          value: state.address,
        },
        {
          name: 'density',
          type: 'select',
          labelKey: 'fieldDensity',
          hintKey: 'fieldDensityHint',
          value: String(state.density),
          width: 'half',
          // The printer's own 1…5, not invented words: "light/normal/dark"
          // would be a mapping the device does not have. The digits still go
          // through the bundle, because an option label is i18n text and a
          // literal here would be a literal however short it is (§5.5).
          options: Array.from(
            { length: DENSITY_MAX - DENSITY_MIN + 1 },
            (_, i) => {
              const level = DENSITY_MIN + i;
              return {
                value: String(level),
                label: text(`density${level}`),
              };
            },
          ),
        },
        {
          name: 'labelType',
          type: 'select',
          labelKey: 'fieldLabelType',
          value: state.labelType,
          width: 'half',
          options: LABEL_TYPES.map((type) => ({
            value: type,
            label: text(labelTypeOptionKey[type]),
          })),
        },
      ],
      submitKey: 'save',
      onSubmit: { action: 'save' },
    }),
    divider(),

    heading('checkSection'),
    paragraph('checkHint', { variant: 'muted' }),
    ...(state.address === ''
      ? [callout('errNoPrinter', 'warning')]
      : [button('check', { action: 'check' }, { variant: 'secondary' })]),
  ]);
