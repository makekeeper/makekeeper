import {
  ExternalAccessClass,
  ExternalPluginManifest,
  validateExternalManifest,
} from '@makekeeper/plugin-contract';

// Guarded readers for JSON/enum columns the core itself persisted. A row is
// written only after validation, so a read that fails here means the row
// predates a contract change (or the store was tampered with) — decision #15
// wants that surfaced as an honest error state, not a naked `as` cast that
// lets a stale shape crash deep inside the renderer (§5.1).

export const EXTERNAL_PLUGIN_STATUSES = [
  'pending',
  'active',
  'disabled',
  'error',
] as const;
export type ExternalPluginStatus = (typeof EXTERNAL_PLUGIN_STATUSES)[number];

export const isExternalPluginStatus = (
  value: string,
): value is ExternalPluginStatus =>
  (EXTERNAL_PLUGIN_STATUSES as readonly string[]).includes(value);

const EXTERNAL_ACCESS_CLASSES: readonly ExternalAccessClass[] = [
  'delegated',
  'background-scoped',
  'background-instance',
];

export const isExternalAccessClass = (
  value: string,
): value is ExternalAccessClass =>
  (EXTERNAL_ACCESS_CLASSES as readonly string[]).includes(value);

const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// A stored manifest goes back through the registration validator: what was
// good enough to install is the only thing good enough to run.
export function readStoredManifest(
  json: string,
): ExternalPluginManifest | null {
  const validated = validateExternalManifest(parseJson(json));
  return validated.ok ? validated.manifest : null;
}

// Grants are a flat string list; anything else in the column contributes
// nothing (an unreadable grant is a grant the plugin does not have).
export function readStoredGrants(json: string): string[] {
  const raw = parseJson(json);
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is string => typeof g === 'string');
}

// A parked manifest update awaiting admin consent (decision #15).
export interface PendingPayload {
  manifest: ExternalPluginManifest;
  baseUrl: string;
  version: string;
  reasons: Array<{ code: string; detail: string }>;
}

export function readStoredPending(json: string): PendingPayload | null {
  const raw = parseJson(json);
  if (!isRecord(raw)) return null;
  const validated = validateExternalManifest(raw['manifest']);
  if (!validated.ok) return null;
  if (
    typeof raw['baseUrl'] !== 'string' ||
    typeof raw['version'] !== 'string'
  ) {
    return null;
  }
  const reasons = Array.isArray(raw['reasons'])
    ? raw['reasons'].filter(
        (r): r is { code: string; detail: string } =>
          isRecord(r) &&
          typeof r['code'] === 'string' &&
          typeof r['detail'] === 'string',
      )
    : [];
  return {
    manifest: validated.manifest,
    baseUrl: raw['baseUrl'],
    version: raw['version'],
    reasons,
  };
}

// Self-written opaque maps (stat dimensions, webhook diffs): shape-checked,
// values beyond the expected primitive kinds are dropped rather than cast.
export function readStoredStringMap(
  json: string,
): Record<string, string> | undefined {
  const raw = parseJson(json);
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

// Changed-field name lists on event deliveries: names only, never values —
// anything that is not a string contributes nothing.
export function readStoredStringArray(json: string): string[] | undefined {
  const raw = parseJson(json);
  if (!Array.isArray(raw)) return undefined;
  const names = raw.filter((v): v is string => typeof v === 'string');
  return names.length > 0 ? names : undefined;
}

export function readStoredRecord(
  json: string,
): Record<string, unknown> | undefined {
  const raw = parseJson(json);
  return isRecord(raw) ? raw : undefined;
}
