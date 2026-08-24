import { PluginManifest } from '@makekeeper/plugin-contract';

// Single source of truth for the UX-mode plugin's identity. The plugin owns the
// user-facing surfaces of the simple/advanced interface mode: the header
// segmented toggle (rendered by the shell while the plugin is enabled) and the
// per-feature override panel in Settings. The mode MECHANICS (preferences
// store, `useUxMode`, the `PluginUxFeature` contract) live in frontend-core /
// plugin-contract — shared infrastructure every plugin consumes. Disabling
// this plugin removes the toggles and forces "everything visible" (advanced
// behavior), never hiding anything the user can't reach.
export const uxmodeManifest: PluginManifest = {
  id: 'uxmode',
  nameKey: 'plugins.uxmode.name',
  descriptionKey: 'plugins.uxmode.description',
  version: '1.0.0',
  icon: 'SlidersHorizontal',
  navigation: [],
};
