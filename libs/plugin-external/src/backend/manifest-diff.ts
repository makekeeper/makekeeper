import {
  ExternalPluginManifest,
  PermissionLevel,
  permissionSetCovers,
} from '@makekeeper/plugin-contract';

// The update diff policy (#133, decision #15): a re-registered manifest is
// applied silently only when it does not EXPAND what the plugin may do. Any
// expansion parks the whole new manifest as "pending admin confirmation" and
// the plugin keeps running with its old manifest and old grants — so a mixed
// update (new screens + new permissions) never half-applies with skew between
// the live manifest and the live grant set. Narrowing, by contrast, applies
// immediately.
//
// Machine-readable reasons feed the consent card, so the admin sees exactly
// WHY an update needs approval.

export interface ManifestExpansion {
  expansion: boolean;
  reasons: Array<{ code: string; detail: string }>;
}

const nonReadToolNames = (m: ExternalPluginManifest): Set<string> =>
  new Set(
    (m.tools ?? [])
      .filter((t) => t.permission !== PermissionLevel.READ)
      .map((t) => t.name),
  );

export function detectExpansion(
  current: ExternalPluginManifest,
  grantedPermissions: readonly string[],
  next: ExternalPluginManifest,
): ManifestExpansion {
  const reasons: Array<{ code: string; detail: string }> = [];

  for (const p of next.permissions) {
    if (!grantedPermissions.includes(p)) {
      reasons.push({ code: 'permission-added', detail: p });
    }
  }

  if (next.scopeModel !== current.scopeModel) {
    reasons.push({ code: 'scope-model-changed', detail: next.scopeModel });
  }

  const currentMutating = nonReadToolNames(current);
  for (const name of nonReadToolNames(next)) {
    if (!currentMutating.has(name)) {
      reasons.push({ code: 'mutating-tool-added', detail: name });
    }
  }

  const currentCaps = new Set((current.capabilities ?? []).map((c) => c.id));
  for (const c of next.capabilities ?? []) {
    if (!currentCaps.has(c.id)) {
      reasons.push({ code: 'capability-added', detail: c.id });
    }
  }

  // A new public path exposes plugin surface to the unauthenticated web
  // (#250) — that is an expansion of what the plugin may do, not a cosmetic
  // change, so it parks for the same consent as a new permission.
  const currentPub = new Set(current.publicPaths ?? []);
  for (const p of next.publicPaths ?? []) {
    if (!currentPub.has(p)) {
      reasons.push({ code: 'public-path-added', detail: p });
    }
  }

  return { expansion: reasons.length > 0, reasons };
}

// The grant set an applied manifest ends up with: exactly what it requests.
// Applying is only legal when this is NOT an expansion of the current grants
// (checked by the caller via detectExpansion / permissionSetCovers).
export const grantsAfterApply = (m: ExternalPluginManifest): string[] => [
  ...m.permissions,
];

export { permissionSetCovers };
