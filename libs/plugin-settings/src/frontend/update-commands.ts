import type { InstallMethod } from '@makekeeper/plugin-contract';

// Shell commands that update a MakeKeeper instance, per install method (#101).
// These are technical identifiers — literal shell invocations that must stay
// byte-identical in every locale — not translatable text; the prose around them
// (titles, the per-method note) lives in the plugin's i18n bundle under
// `settings.updates.guide.*`. Kept in sync with the "Updating" section of
// INSTALL.md.
//
// Product specifics (image names, our repo layout) deliberately live here in the
// plugin rather than in `plugin-contract`: that library is the Apache-2.0 SDK
// third-party plugin authors import, and it stays generic — it owns the
// `InstallMethod` vocabulary, not MakeKeeper's own update instructions.
//
// An empty list means "there is nothing to type": the manager is driven from its
// own UI (Redeploy / Re-pull image), so only the i18n note is shown.
export const UPDATE_COMMANDS: Record<InstallMethod, readonly string[]> = {
  'install-sh': ['cd makekeeper', './update.sh'],
  compose: [
    'docker compose -f docker-compose.prod.yml pull',
    'docker compose -f docker-compose.prod.yml up -d',
  ],
  coolify: [],
  dokploy: [],
  portainer: [],
  kubernetes: [
    'kubectl set image deployment/makekeeper-app app=ghcr.io/makekeeper/app:<tag>',
    'kubectl rollout status deployment/makekeeper-app',
  ],
  dev: ['git pull', 'npm install'],
  unknown: [],
};
