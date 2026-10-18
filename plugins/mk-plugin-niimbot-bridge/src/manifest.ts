import {
  EXTERNAL_CONTRACT_VERSION,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

// The BLE print bridge (#362): a first-party EXTERNAL plugin that owns a
// Niimbot label printer.
//
// It exists because Web Bluetooth does not: the browser driver (#359) works
// only in Chromium, so an iPhone — where every browser is WebKit — can never
// reach the printer itself. A container running on the box next to the printer
// can, and then ANY client prints by submitting a raster through the core.
// It also gives several people one shared printer instead of one Bluetooth
// link per browser.
//
// `printDriver` is the whole point of the manifest: the core registers a
// `printing.driver.<pluginId>` capability for it, and `codes` offers "Print on
// <this>" next to the browser's own driver with no change of its own.
//
// Geometry is declared, not discovered: the printhead is 384 dots at 203 dpi on
// a B1 — the facts verified on hardware in #359 — and a consumer needs them to
// lay out a page before any printer is even awake.
const SOURCE_VERSION = '0.1.0';

export const manifest: ExternalPluginManifest = {
  contract: EXTERNAL_CONTRACT_VERSION,
  pluginId: 'niimbot-bridge',
  // A released image overrides this with the version its tag was cut at, so
  // what the core displays names the actual release.
  version: process.env['MK_PLUGIN_VERSION']?.trim() || SOURCE_VERSION,
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Printer',
  // The printer is one machine in one workshop: instance-wide, not per-scope.
  scopeModel: 'instance',
  // Nothing of the instance's data is needed to print a page somebody else
  // rendered — the bridge receives dots and a copy count.
  permissions: [],
  i18n: { en, ru },
  screens: ['settings'],
  settingsScreen: 'settings',
  printDriver: {
    labelKey: 'printer',
    maxWidthDots: 384,
    dpi: 203,
  },
};
