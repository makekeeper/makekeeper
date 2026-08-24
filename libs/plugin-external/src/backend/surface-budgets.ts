// Per-surface time budgets (#134, decision #8 of #131).
//
// Why budgets differ by surface: the plugin's OWN screen is what the user
// navigated to, so waiting is honest and a miss must be named. A widget or a
// slot contribution is a GUEST on someone else's page — it may not hold that
// page hostage, and on a miss it silently disappears, exactly as a contribution
// from a disabled plugin already does today (see manifest.ts).

export const EXTERNAL_SURFACES = [
  'screen',
  'widget',
  'slot',
  'ref',
  'tool',
  'hook',
] as const;
export type ExternalSurface = (typeof EXTERNAL_SURFACES)[number];

// Code DEFAULTS — the admin can override any of them (decision #8: budgets
// are admin-tunable defaults); ExternalSettingsService holds the overrides.
export const SURFACE_BUDGET_MS: Record<ExternalSurface, number> = {
  screen: 5_000,
  widget: 800,
  slot: 800,
  ref: 800,
  tool: 10_000,
  // Exchange/purge hooks stream real data: generous by nature (#138).
  hook: 60_000,
};
