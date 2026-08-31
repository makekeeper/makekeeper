import { PluginManifest } from '@makekeeper/plugin-contract';

// Identity of the notification plugin (#307). It owns the bus, the inbox and
// the bell — and deliberately no sidebar entry: an inbox is something you
// glance at from wherever you are, not a place you navigate to.
export const notifyManifest: PluginManifest = {
  id: 'notify',
  nameKey: 'plugins.notify.name',
  descriptionKey: 'plugins.notify.description',
  version: '1.0.0',
  icon: 'Bell',
  // No navigation of its own. The inbox is something you glance at from the
  // header, and where notifications go is a PLUGIN SETTING — so it registers a
  // settings panel and shows up beside every other plugin's under
  // Settings → General, rather than claiming a tab of the hub.
  navigation: [],
};
