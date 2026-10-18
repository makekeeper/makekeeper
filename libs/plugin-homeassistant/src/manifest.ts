import { PluginManifest } from '@makekeeper/plugin-contract';

// Single source of truth for the Home Assistant gateway's identity (#364).
//
// The plugin is a TRANSPORT and deliberately nothing else: it holds the
// instance's Home Assistant address and token, answers "what entities are
// there" and "call this action", and knows nothing about any device on the
// other side. The first consumer prints labels on a Niimbot through it, and
// that knowledge lives in the Niimbot plugin — the moment this one grows a
// `printNiimbot()`, the seam it exists for is gone.
//
// No screen and no sidebar entry: a transport has nothing to show. Its
// settings ARE instance administration — one address and one long-lived token
// for everybody — so `settingsAdminOnly` hides the panel from non-admins while
// the multi-user overlay is on, and every route carries `@AdminOnly()`.
//
// Shipped DISABLED (§5.8): a workshop without Home Assistant should not grow a
// Home Assistant panel in its Settings, and the plugins screen is where one is
// turned on. Instances that already enabled it keep their own row — the flag
// only seeds a plugin's first registration.
//
// Deliberately NO agent tools (§5.7). What this plugin holds is an admin
// credential and a way to call any action in somebody's house; the product's
// own agents have no business with either, and the devices worth exposing
// belong to the plugins that own them.
export const homeassistantManifest: PluginManifest = {
  id: 'homeassistant',
  nameKey: 'plugins.homeassistant.name',
  descriptionKey: 'plugins.homeassistant.description',
  version: '1.0.0',
  icon: 'House',
  navigation: [],
  settingsAdminOnly: true,
  defaultEnabled: false,
};
