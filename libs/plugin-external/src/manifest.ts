import { PluginManifest } from '@makekeeper/plugin-contract';

// Single source of truth for the external-plugins HOST plugin (#131/#133).
// This internal plugin owns the machinery that lets out-of-process third-party
// plugins join the instance: the self-registration endpoint, the consent flow,
// token issuance/revocation and the admin surface listing installed external
// plugins. The external plugins themselves are DATA (ExternalPlugin rows +
// cached manifests), never code inside this repo.
export const externalManifest: PluginManifest = {
  id: 'external',
  nameKey: 'plugins.external.name',
  descriptionKey: 'plugins.external.description',
  version: '1.0.0',
  icon: 'Blocks',
  // A guest tab of the Settings hub: managing external plugins is instance
  // configuration, same placement rationale as exchange (#110).
  navigation: [
    {
      path: '/settings/external',
      titleKey: 'nav.external',
      icon: 'Blocks',
      hub: 'settings',
      order: 120,
      adminOnly: true,
    },
  ],
  // Registration, grants and tokens are instance administration.
  settingsAdminOnly: true,
};
