import {
  bindDashboardWidgets,
  registerPlugin,
} from '@makekeeper/frontend-core';
import { statsManifest } from '../manifest';
import StatsPilotWidget from './dashboard/StatsPilotWidget.vue';
import StatsView from './StatsView.vue';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

registerPlugin({
  id: statsManifest.id,
  nameKey: statsManifest.nameKey,
  navigation: statsManifest.navigation,
  uxFeatures: statsManifest.uxFeatures,
  messages: { en, ru },
  dashboardWidgets: bindDashboardWidgets(statsManifest.dashboardWidgets, {
    'stats.pilot': StatsPilotWidget,
  }),
  routes: [{ path: '/stats', name: 'stats', component: StatsView }],
});
