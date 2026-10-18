import type { NiimbotLabelType } from './label-stock';

// How the printer prints, whatever route carried the job here (#366).
//
// Its own module, and deliberately not the Home Assistant one: these two
// values are the reason this change exists — they belong to the PRINTER, and
// filing them under a route's contract would re-make the mistake the panel was
// showing (density asked twice because each route kept its own copy).
export interface NiimbotPrintSettings {
  density: number;
  // The stock as this plugin names it. Narrow on purpose: an unknown value is
  // decided once, where the row is read, not at every call site that puts it
  // on a wire.
  labelType: NiimbotLabelType;
  // Whether anything was ever saved here. A screen uses it for the one-time
  // carry-over of values a browser remembers from before these were instance
  // settings — an instance that never had any takes them rather than resetting
  // somebody's printer.
  configured: boolean;
}

// What a write may change. One type, because the two values travel together
// everywhere: the service, the store, the screen and the job builder.
export type NiimbotPrintSettingsPatch = Partial<
  Pick<NiimbotPrintSettings, 'density' | 'labelType'>
>;

// What the one-time carry-over should write, or nothing.
//
// A pure decision, apart from the store that makes it, because the ordering
// around it is the part that bites: what this browser remembers has to be read
// BEFORE the instance is asked, since asking is what overwrites the cache it is
// read from. The store owns that sequence; this owns the rule.
export function carryOverPatch(
  // What this browser remembered from when these were per-browser settings.
  remembered: NiimbotPrintSettingsPatch | null,
  // Whether the instance has print settings of its own. `null` = not asked yet,
  // which is never a reason to write.
  configured: boolean | null,
): NiimbotPrintSettingsPatch | null {
  if (configured !== false) return null;
  if (!remembered) return null;
  if (remembered.density === undefined && remembered.labelType === undefined) {
    return null;
  }
  return remembered;
}
