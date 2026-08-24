import {
  registerPlugin,
  registerManifestContributions,
  useUxMode,
  type PluginContribution,
} from '@makekeeper/frontend-core';
import { codesManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import CodeRedirectView from './CodeRedirectView.vue';
import ScanPhoneSurface from './ScanPhoneSurface.vue';
import GlobalScanButton from './GlobalScanButton.vue';
import ScanContextButton from './ScanContextButton.vue';
import ScanStatusIndicator from './ScanStatusIndicator.vue';
import PrintLabelButton from './PrintLabelButton.vue';
import CodesBenchAction from './CodesBenchAction.vue';

// In-app scanning follows one key (#269); evaluated lazily, after pinia is up.
const scanVisible = (): boolean => useUxMode().isFeatureVisible('codes.scan');

registerPlugin({
  id: codesManifest.id,
  nameKey: codesManifest.nameKey,
  navigation: codesManifest.navigation,
  uxFeatures: codesManifest.uxFeatures,
  messages: { en, ru },
  // The one public route: the `/c/<code>` label deep-link. No sidebar, no
  // screen of its own — scanning is buttons, printing is a slot contribution.
  routes: [
    {
      path: '/c/:code',
      name: 'codeRedirect',
      component: CodeRedirectView,
      meta: { fullscreen: true, public: true },
    },
  ],
  contributions: [
    // The phone-side scan surface, rendered by the phone-bridge shell (#77).
    // NOT lens-gated: the phone surface is a device shape, like mobile nav.
    { slot: 'phone-bridge.surface.scan', component: ScanPhoneSurface },
    // The global "Scan" button in the app header (app-owned slot). Simple by
    // default, demotable to the pro tier (#269).
    {
      slot: 'app.header.scan',
      component: GlobalScanButton,
      visible: scanVisible,
    },
    // The "Scan" verb in the home dashboard action strip (#90): kicks off a
    // global scan through the shared session store (host stays in the header).
    {
      slot: 'dashboard.actions',
      component: CodesBenchAction,
      order: 25,
      visible: scanVisible,
    },
  ],
});

// Host-agnostic labelling/scanning (#74): mount codes' buttons into whatever
// slots host plugins declare in `manifest.codes`, discovered at runtime — no
// hardcoded target slots.
registerManifestContributions('codes', (manifests) => {
  const contributions: PluginContribution[] = [];
  for (const manifest of manifests) {
    for (const entity of manifest.codes?.labelable ?? []) {
      contributions.push({
        slot: entity.slot,
        component: PrintLabelButton,
        // Printing follows the pro lens (#269); scanning below stays basic.
        visible: () => useUxMode().isFeatureVisible('codes.labels'),
      });
    }
    if (manifest.codes?.scan) {
      contributions.push({
        slot: manifest.codes.scan.slot,
        component: ScanContextButton,
        visible: scanVisible,
      });
      // Optional second mount point: the live-session badge, shown wherever the
      // host displays the context itself (#79).
      if (manifest.codes.scan.statusSlot) {
        contributions.push({
          slot: manifest.codes.scan.statusSlot,
          component: ScanStatusIndicator,
          visible: scanVisible,
        });
      }
    }
  }
  return contributions;
});
