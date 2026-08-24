import type {
  DeployHookMethod,
  InstallMethod,
} from '@makekeeper/plugin-contract';

// Where the admin gets the deploy hook they are asked to paste (#108).
//
// #97 established that the app cannot learn its manager's webhook from inside
// the container, so the hook is pasted by hand — which only works if the UI says
// which screen of the manager to open. This module owns that per-manager recipe:
// the ORDER and the technical facts (HTTP method, whether a bearer token is
// needed, the URL shape) live here; the prose of each step lives in the plugin's
// i18n bundle under `settings.updates.hook.source.*` (§5.5).
//
// The manager set is deliberately narrower than `InstallMethod`: a compose or
// install.sh instance has no manager to ask, and `other` covers everything we
// don't ship a recipe for. Kept in sync with the "One-click update" section of
// INSTALL.md.
export const DEPLOY_HOOK_SOURCES = [
  'coolify',
  'dokploy',
  'portainer',
  'other',
] as const;

export type DeployHookSource = (typeof DEPLOY_HOOK_SOURCES)[number];

export interface DeployHookRecipe {
  // i18n keys, in the order the admin performs them.
  readonly steps: readonly string[];
  // The URL the manager expects, with a placeholder the admin fills in — a
  // technical literal that must stay byte-identical in every locale. `null`
  // where the manager mints an opaque URL the admin can only copy.
  readonly urlTemplate: string | null;
  readonly method: DeployHookMethod;
  readonly needsToken: boolean;
}

const key = (source: DeployHookSource, step: number): string =>
  `settings.updates.hook.source.steps.${source}.${step}`;

export const DEPLOY_HOOK_RECIPES: Record<DeployHookSource, DeployHookRecipe> = {
  coolify: {
    steps: [key('coolify', 1), key('coolify', 2), key('coolify', 3)],
    urlTemplate: 'https://<coolify-host>/api/v1/deploy?uuid=<uuid>&force=false',
    method: 'GET',
    needsToken: true,
  },
  dokploy: {
    steps: [key('dokploy', 1), key('dokploy', 2), key('dokploy', 3)],
    urlTemplate: null,
    method: 'POST',
    needsToken: false,
  },
  portainer: {
    steps: [key('portainer', 1), key('portainer', 2), key('portainer', 3)],
    urlTemplate: null,
    method: 'POST',
    needsToken: false,
  },
  other: {
    steps: [key('other', 1), key('other', 2)],
    urlTemplate: null,
    method: 'POST',
    needsToken: false,
  },
};

// The detected install method (#100) picks the tab that opens first. Anything we
// have no recipe for — compose, install.sh, kubernetes, dev, unknown — lands on
// `other`, whose steps describe the generic "any redeploy endpoint" case rather
// than pretending a manager exists.
export function deployHookSourceFor(
  method: InstallMethod | null,
): DeployHookSource {
  switch (method) {
    case 'coolify':
    case 'dokploy':
    case 'portainer':
      return method;
    default:
      return 'other';
  }
}
