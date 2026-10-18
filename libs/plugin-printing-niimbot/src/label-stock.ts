// What the machine is loaded with, and how hard to burn it — shared by both
// routes to the printer.
//
// Lifted out of `frontend/settings-store.ts` when the Home Assistant route
// (#364) arrived: the backend needs the same three stock names and the same
// density bounds, and importing them from the frontend store would drag pinia
// into the server. The vocabulary is the printer's, so it belongs to neither
// side.

// Label stock the B1 ships paper for. Wire values live with each transport:
// the Bluetooth driver resolves them through niimbluelib's `LabelType`, the
// Home Assistant route through `HA_LABEL_TYPE_CODES` below.
export const NIIMBOT_LABEL_TYPES = [
  'withGaps',
  'black',
  'transparent',
] as const;
export type NiimbotLabelType = (typeof NIIMBOT_LABEL_TYPES)[number];

export function isNiimbotLabelType(value: unknown): value is NiimbotLabelType {
  return NIIMBOT_LABEL_TYPES.some((type) => type === value);
}

export const DENSITY_MIN = 1;
export const DENSITY_MAX = 5;
// The printer's own default (confirmed on the device, #359).
export const DENSITY_DEFAULT = 3;

export function clampDensity(value: number): number {
  if (!Number.isFinite(value)) return DENSITY_DEFAULT;
  return Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, Math.round(value)));
}

// hass-niimbot takes the stock as a number, and these are its codes
// (`niimprint/model.py`, `_LABEL_TYPE_CODES`): the same three types this plugin
// already names, so nothing symbolic has to be invented for the HA route.
export const HA_LABEL_TYPE_CODES: Record<NiimbotLabelType, number> = {
  withGaps: 1,
  black: 2,
  transparent: 5,
};

// The B1's own geometry, as the Home Assistant route needs it (#364).
//
// 320 dots, not the printhead's 384: hass-niimbot composes a LABEL-sized
// canvas and lets the firmware place it, so the page we hand it must be the
// 40 mm sticker (40 mm × 203 dpi ÷ 25.4). A 384-dot page would be resampled or
// clipped — and `codes` already keeps every drop of ink inside the 40 mm
// stock, so nothing is lost by saying so here.
export const B1_DPI = 203;
export const B1_LABEL_WIDTH_DOTS = 320;
// 30 mm of feed, the other half of the stock `codes` lays a label out on. Used
// only for the settings screen's test pattern — a real job's height comes with
// its raster.
export const B1_LABEL_HEIGHT_DOTS = 240;
