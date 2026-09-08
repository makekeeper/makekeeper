import { describe, it, expect } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';

// The rungs of the overlay ladder are load-bearing, and one of them is
// counter-intuitive: a popover outranks a dialog on purpose, because a
// `Select` dropdown opened INSIDE a dialog has to cover it. #351 was a
// coachmark abusing that rule from outside a dialog, and the fix was to teach
// the coachmark about dialogs — not to lower the tier. This guards the tier
// against the "obvious" fix being applied later by someone reading only the
// symptom.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The Tailwind config is plain CJS and carries no types of its own, so its
// shape is narrowed rather than asserted: a restructured config is then
// reported as a missing rung by the first test, where an assertion would hand
// back `undefined` and leave every comparison below quietly false.
const readTiers = (config: unknown): Map<string, number> => {
  const tiers = new Map<string, number>();
  if (!isRecord(config)) return tiers;
  const theme = config.theme;
  if (!isRecord(theme)) return tiers;
  const extend = theme.extend;
  if (!isRecord(extend)) return tiers;
  const zIndex = extend.zIndex;
  if (!isRecord(zIndex)) return tiers;
  for (const [name, value] of Object.entries(zIndex)) {
    const rung = Number(value);
    if (Number.isFinite(rung)) tiers.set(name, rung);
  }
  return tiers;
};

const tiers = readTiers(tailwindConfig);

const rung = (name: string): number => tiers.get(name) ?? Number.NaN;

describe('overlay ladder', () => {
  it('defines every rung the ladder is made of', () => {
    // NaN loses every `toBeGreaterThan` silently, so the rungs are proved
    // present before any of them are compared.
    for (const name of ['modal', 'confirm', 'popover', 'tooltip', 'overlay']) {
      expect(rung(name), name).not.toBeNaN();
    }
  });

  it('keeps popovers above every dialog layer', () => {
    expect(rung('popover')).toBeGreaterThan(rung('confirm'));
    expect(rung('confirm')).toBeGreaterThan(rung('modal'));
  });

  it('keeps the offline overlay above everything', () => {
    expect(rung('overlay')).toBeGreaterThan(rung('tooltip'));
    expect(rung('tooltip')).toBeGreaterThan(rung('popover'));
  });
});
