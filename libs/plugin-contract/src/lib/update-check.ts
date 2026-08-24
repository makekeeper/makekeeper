// Shared contract for the instance update checker (admin settings, #94). The
// backend queries GitHub for the latest published release tag and compares it to
// the running version; the admin settings UI renders this state.

// The outcome of the most recent check — distinguishes "we know the latest and
// it's not newer" from "we couldn't reach the source" (offline/air-gapped).
export type UpdateCheckStatus = 'ok' | 'unreachable' | 'never';

// Admin-editable settings.
export interface UpdateCheckSettings {
  // Run an automatic check once a day at `checkHourUtc`. Off by default: an
  // outbound check is a phone-home, so it is opt-in.
  autoCheckEnabled: boolean;
  // Hour of day (UTC, 0–23) the daily auto-check runs. Never more than once/day.
  checkHourUtc: number;
}

// Full state returned to the admin UI.
export interface UpdateCheckState extends UpdateCheckSettings {
  // Running release, e.g. "0.1.0" ("dev" for local/unpinned builds).
  currentVersion: string;
  // Latest tag seen at the source, or null if never successfully checked.
  latestVersion: string | null;
  // currentVersion is a real semver AND latestVersion is strictly newer.
  updateAvailable: boolean;
  // ISO timestamp of the last completed check attempt, or null.
  lastCheckedAt: string | null;
  // Outcome of that attempt.
  lastCheckStatus: UpdateCheckStatus;
  // Web page for the latest release (release notes), or null.
  releaseUrl: string | null;
}

// Public (non-admin) subset the app shell reads to show the version + a "newer
// available" hint in the sidebar. No settings/schedule leak here.
export interface UpdateVersionSummary {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

export const MIN_CHECK_HOUR_UTC = 0;
export const MAX_CHECK_HOUR_UTC = 23;
