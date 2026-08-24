// The palette of named tag tones (#60). A tag's colour is either one of these
// tones — mapped by the chip to design-system Tailwind classes with proper
// light/dark pairs (CLAUDE.md §5.4) — or a user-picked "#rrggbb" hex (see
// isHexColor below). Shared by the backend (DTO validation, default) and the
// frontend (chip class map, colour picker), so the set is defined once.
export const TAG_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'emerald',
  'teal',
  'sky',
  'violet',
  'pink',
  'brand',
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

// The fallback tone, used when a create omits a colour or an unknown value slips
// through (defensive — the DTO already constrains input to TAG_COLORS).
export const DEFAULT_TAG_COLOR: TagColor = 'slate';

export function isTagColor(value: unknown): value is TagColor {
  return (
    typeof value === 'string' &&
    (TAG_COLORS as readonly string[]).includes(value)
  );
}

// A user-chosen custom colour: a 6-digit hex like "#3b82f6". Palette tones are
// design-system tokens; a hex is content the user picked, rendered via an inline
// style on the chip (the one sanctioned exception to §5.4's token rule).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Seed for the custom-colour picker before the user picks anything — brand.500
// (the app accent in tailwind.config.js), so the first custom pick starts
// on-brand.
export const DEFAULT_CUSTOM_HEX = '#3b82f6';

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

// A stored `Tag.color` is valid if it is a palette tone OR a hex colour.
export function isTagColorValue(value: unknown): value is string {
  return isTagColor(value) || isHexColor(value);
}

// Accepts a palette tone or a "#rrggbb" hex — the DTO validation pattern for the
// colour field (derived from TAG_COLORS so the set stays single-sourced).
export const TAG_COLOR_PATTERN = new RegExp(
  `^(#[0-9a-fA-F]{6}|${TAG_COLORS.join('|')})$`,
);
