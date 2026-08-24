import { PluginManifest } from '@makekeeper/plugin-contract';

// Single source of truth for the multiuser overlay's identity. Not `core`: the
// whole point is that the plugin's enabled flag IS the multi-user mode toggle —
// disabled means the app runs single-user with no access control, exactly as
// before the plugin existed.
export const multiuserManifest: PluginManifest = {
  id: 'multiuser',
  nameKey: 'plugins.multiuser.name',
  descriptionKey: 'plugins.multiuser.description',
  version: '1.0.0',
  icon: 'Users',
  // The enabled flag IS the multi-user mode switch — ships off so upgrading an
  // existing single-user instance changes nothing until explicitly enabled.
  defaultEnabled: false,
  settingsAdminOnly: true,
  // The Access hub (#110): accounts and scope sharing are not instance settings,
  // so they get their own sidebar entry instead of crowding Settings. A pure
  // container — the hub itself has no content and lands on its first visible
  // tab, so the role decides (admin → Users, regular user → Sharing).
  navigation: [
    {
      path: '/access',
      titleKey: 'nav.access',
      icon: 'Users',
      section: 'system',
      hubId: 'access',
    },
    {
      path: '/access/users',
      titleKey: 'nav.users',
      icon: 'UserRound',
      hub: 'access',
      order: 10,
      adminOnly: true,
    },
    {
      path: '/access/sharing',
      titleKey: 'nav.sharing',
      icon: 'Share2',
      hub: 'access',
      order: 20,
    },
    {
      path: '/access/my-plugins',
      titleKey: 'nav.myPlugins',
      icon: 'Blocks',
      hub: 'access',
      order: 30,
    },
  ],
  // Instance backup (#62): accounts, grants, per-user plugin sets, overlay
  // settings. Password hashes make this `sensitive` (include-secrets only).
  exchange: {
    sections: [
      {
        key: 'multiuser.all',
        labelKey: 'multiuser.exchange.sections.all',
        roots: ['instance'],
        sensitive: true,
      },
    ],
  },
};
