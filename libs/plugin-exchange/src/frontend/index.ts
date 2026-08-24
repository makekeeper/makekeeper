import { registerPlugin, useUxMode } from '@makekeeper/frontend-core';
import { exchangeManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import ExchangeView from './ExchangeView.vue';
import ExportSlotAction from './ExportSlotAction.vue';

registerPlugin({
  id: exchangeManifest.id,
  nameKey: exchangeManifest.nameKey,
  navigation: exchangeManifest.navigation,
  uxFeatures: exchangeManifest.uxFeatures,
  messages: { en, ru },
  // Nested into the Settings hub's layout by the shell (`meta.hub`), so the tab
  // bar stays on screen — the path is relative to the hub's own `/settings`.
  // Neither plugin imports the other; the hub id is the whole contract (§5.10).
  routes: [
    {
      path: 'exchange',
      name: 'exchange',
      component: ExchangeView,
      meta: { hub: 'settings' },
    },
  ],
  // In-context "Export" action in the standard page-header actions slot. A page
  // opts in by passing its entity ORef as PageHeader's `context-ref`; the slot
  // ctx carries it as `entityRef`, the action derives the export root from the
  // backend catalog and renders nothing for non-exportable refs. One predictable
  // top-right spot on every exportable page instead of a per-page location.
  contributions: [
    {
      slot: 'page.header.actions',
      component: ExportSlotAction,
      // Follows the SAME key as the exchange page (#269): export is one
      // feature, whichever surface it shows on.
      visible: () => useUxMode().isFeatureVisible('exchange.page'),
    },
  ],
});
