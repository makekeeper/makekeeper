import {
  bindDashboardWidgets,
  registerPlugin,
} from '@makekeeper/frontend-core';
import type { MobileRouteMeta } from '@makekeeper/plugin-contract';

import ComponentQuickCreateModal from './ComponentQuickCreateModal.vue';
import ProjectComponentActions from './ProjectComponentActions.vue';
import ScanIntoCellAction from './ScanIntoCellAction.vue';
import InventoryBenchActions from './InventoryBenchActions.vue';
import CellScanStatus from './CellScanStatus.vue';
import { inventoryManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import InventoryView from './InventoryView.vue';
import CategoriesView from './CategoriesView.vue';
import InventoryFormView from './InventoryFormView.vue';
import MobileIntakeView from './mobile/MobileIntakeView.vue';
import IntakeDraftsView from './mobile/IntakeDraftsView.vue';
import MobileStockView from './mobile/MobileStockView.vue';
import MobileItemView from './mobile/MobileItemView.vue';
import IntakeHelpCard from './mobile/IntakeHelpCard.vue';
import LowStockStatWidget from './dashboard/LowStockStatWidget.vue';
import RestockListWidget from './dashboard/RestockListWidget.vue';
import StockTimelineWidget from './dashboard/StockTimelineWidget.vue';
import ProjectFlowSankeyWidget from './dashboard/ProjectFlowSankeyWidget.vue';

registerPlugin({
  id: inventoryManifest.id,
  nameKey: inventoryManifest.nameKey,
  navigation: inventoryManifest.navigation,
  messages: { en, ru },
  // Mobile intake (#200). The tab comes from the manifest, the screen is bound
  // here — the same split dashboard widgets use.
  mobileNavigation: inventoryManifest.mobile,
  mobileRoutes: [
    // The camera, and — under `?phase=` — the two forms it leads to. One route
    // and one component on purpose: the faces share the frames, the uploaded
    // urls and the candidate list, and a route change would remount the thing
    // holding them. The phase lives in the QUERY so it is still navigation
    // (§5.3): a history entry the swipe-back gesture can pop, which is what it
    // was not — a swipe out of the new-item form used to leave the whole screen
    // and land wherever you had been before the intake tab.
    {
      path: '/m/inventory',
      name: 'mobile-inventory',
      component: MobileIntakeView,
      meta: { titleKey: 'inventory.mobile.tab' } satisfies MobileRouteMeta,
    },
    // The confirm half of the conveyor (#201) — same component the desktop
    // route below mounts, because the drafts are server-side precisely so the
    // batch can be finished on whichever screen is nearer.
    //
    // `parent` is what gives it a way back to the camera. Without one its only
    // exit was the tab bar, where the lit tab was the intake tab it had just
    // come from — a highlight that reads as "you are here", on the one control
    // that would have taken you away.
    {
      path: '/m/inventory/drafts',
      name: 'mobile-inventory-drafts',
      component: IntakeDraftsView,
      meta: {
        tab: '/m/inventory',
        parent: '/m/inventory',
        titleKey: 'inventory.mobile.drafts',
        subtitleKey: 'inventory.mobile.draftsSubtitle',
      } satisfies MobileRouteMeta,
    },
    // Finding what is already on the shelf, and correcting it (#203).
    {
      path: '/m/inventory/stock',
      name: 'mobile-inventory-stock',
      component: MobileStockView,
      meta: {
        titleKey: 'inventory.mobile.stockTitle',
      } satisfies MobileRouteMeta,
    },
    // Opened from STOCK, and nested under the intake path only by spelling —
    // which is exactly why the tab it belongs to is declared rather than
    // derived: the prefix rule lit intake here.
    {
      path: '/m/inventory/item/:id',
      name: 'mobile-inventory-item',
      component: MobileItemView,
      meta: {
        tab: '/m/inventory/stock',
        parent: '/m/inventory/stock',
        // No title: this screen's subject is the part's own name, which leads
        // the content already. A second copy in the bar would say it twice.
      } satisfies MobileRouteMeta,
    },
  ],
  uxFeatures: inventoryManifest.uxFeatures,
  dashboardWidgets: bindDashboardWidgets(inventoryManifest.dashboardWidgets, {
    'inventory.lowStock': LowStockStatWidget,
    'inventory.restockList': RestockListWidget,
    'inventory.stockTimeline': StockTimelineWidget,
    'inventory.projectFlowsChart': ProjectFlowSankeyWidget,
  }),
  // The minimal "new part" dialog contributed into the logistics order form
  // (#53/#58) so every component-creation flow asks the same questions — and
  // vanishes with the inventory plugin.
  contributions: [
    // What the intake screen's buttons do, on the phone's home screen (#200).
    // Written by the plugin that owns those buttons, so it leaves with it.
    {
      slot: 'mobile.home.help',
      component: IntakeHelpCard,
    },
    // Inventory's verbs in the home dashboard action strip (#90).
    {
      slot: 'dashboard.actions',
      component: InventoryBenchActions,
      order: 20,
    },
    {
      slot: 'logistics.order-form.quick-create',
      component: ComponentQuickCreateModal,
    },
    // Per-row reserve/consume/release actions on the project BOM table (#58).
    {
      slot: 'projects.component-row.actions',
      component: ProjectComponentActions,
    },
    // "Scan items into this cell" on the open storage cell (#79): placement is
    // inventory data, so inventory owns the action inside the storages view.
    {
      slot: 'storages.cell.actions',
      component: ScanIntoCellAction,
    },
    // The live-session badge in that cell's header — same ownership chain, so a
    // scan started here stays visible on return without storages knowing codes.
    {
      slot: 'storages.cell.status',
      component: CellScanStatus,
    },
  ],
  statsCharts: inventoryManifest.statsCharts,
  routes: [
    { path: '/inventory', name: 'inventory', component: InventoryView },
    // The category vocabulary (#205) — a tab of the inventory page, not a
    // settings screen: it is warehouse data a scope owner curates.
    {
      path: '/inventory/categories',
      name: 'inventory-categories',
      component: CategoriesView,
    },
    {
      path: '/inventory/new',
      name: 'inventory-new',
      component: InventoryFormView,
    },
    {
      path: '/inventory/:id/edit',
      name: 'inventory-edit',
      component: InventoryFormView,
    },
    // Finishing a phone batch on a bigger screen (#201).
    {
      path: '/inventory/intake',
      name: 'inventory-intake',
      component: IntakeDraftsView,
    },
  ],
  // A component ORef navigates to its edit screen (the only per-component route).
  refToRoute: (ref) =>
    ref.entityType === 'component'
      ? { path: `/inventory/${ref.entityId}/edit` }
      : ref.entityType === 'category'
        ? { path: '/inventory/categories', query: { id: ref.entityId } }
        : null,
});
