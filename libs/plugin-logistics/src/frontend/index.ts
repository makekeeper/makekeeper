import {
  bindDashboardWidgets,
  registerPlugin,
  useUxMode,
} from '@makekeeper/frontend-core';
import { Truck } from '@lucide/vue';
import { logisticsManifest } from '../manifest';
import ProjectLogisticsTab from './ProjectLogisticsTab.vue';
import ShoppingListOrderAction from './ShoppingListOrderAction.vue';
import TaskOrderDependencies from './TaskOrderDependencies.vue';
import LogisticsBenchAction from './LogisticsBenchAction.vue';
import IncomingStatWidget from './dashboard/IncomingStatWidget.vue';
import IncomingOrdersWidget from './dashboard/IncomingOrdersWidget.vue';
import SpendChartWidget from './dashboard/SpendChartWidget.vue';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import LogisticsView from './LogisticsView.vue';
import OrderFormView from './OrderFormView.vue';
import LogisticsSettings from './LogisticsSettings.vue';

registerPlugin({
  id: logisticsManifest.id,
  nameKey: logisticsManifest.nameKey,
  navigation: logisticsManifest.navigation,
  messages: { en, ru },
  routes: [
    { path: '/logistics', name: 'logistics', component: LogisticsView },
    { path: '/logistics/new', name: 'logistics-new', component: OrderFormView },
    {
      path: '/logistics/:id/edit',
      name: 'logistics-edit',
      component: OrderFormView,
    },
  ],
  uxFeatures: logisticsManifest.uxFeatures,
  dashboardWidgets: bindDashboardWidgets(logisticsManifest.dashboardWidgets, {
    'logistics.incoming': IncomingStatWidget,
    'logistics.incomingOrders': IncomingOrdersWidget,
    'logistics.spend': SpendChartWidget,
  }),
  // Order-shaped UI this plugin injects into the projects plugin (#58): the
  // project-detail Logistics tab, the shopping-list "create order" action and
  // the task form's delivery-dependencies editor. All vanish with the plugin.
  contributions: [
    // Logistics' verb in the home dashboard action strip (#90).
    {
      slot: 'dashboard.actions',
      component: LogisticsBenchAction,
      order: 30,
    },
    {
      slot: 'projects.detail.tabs',
      component: ProjectLogisticsTab,
      meta: {
        tabId: 'logistics',
        labelKey: 'projectDetail.tabs.logistics',
        icon: Truck,
        // Advanced surface (#53): hidden in simple mode unless re-enabled. The
        // check runs lazily inside the host's computed, after pinia is live.
        visible: () => useUxMode().isFeatureVisible('logistics.projectTab'),
      },
    },
    {
      slot: 'projects.shopping-list.actions',
      component: ShoppingListOrderAction,
    },
    {
      slot: 'projects.task-form.order',
      component: TaskOrderDependencies,
    },
  ],
  // Parcel-tracking provider config lives in the Settings host (admin-only).
  settings: {
    descriptionKey: logisticsManifest.descriptionKey,
    version: logisticsManifest.version,
    icon: logisticsManifest.icon,
    component: LogisticsSettings,
  },
});
