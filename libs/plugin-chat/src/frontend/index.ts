import {
  bindDashboardWidgets,
  registerPlugin,
  useUxMode,
} from '@makekeeper/frontend-core';
import { chatManifest } from '../manifest';
import UserActivityWidget from './dashboard/UserActivityWidget.vue';
import ProvidersRowsWidget from './dashboard/prototypes/ProvidersRowsWidget.vue';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import AiProviderSettings from './AiProviderSettings.vue';
import AiHistoryTab from './ai-history/AiHistoryTab.vue';
import ChatBenchAction from './ChatBenchAction.vue';
import { Bot } from '@lucide/vue';

registerPlugin({
  id: chatManifest.id,
  nameKey: chatManifest.nameKey,
  navigation: chatManifest.navigation,
  uxFeatures: chatManifest.uxFeatures,
  messages: { en, ru },
  routes: [],
  dashboardWidgets: bindDashboardWidgets(chatManifest.dashboardWidgets, {
    'chat.activity': UserActivityWidget,
    'chat.providerUsage': ProvidersRowsWidget,
  }),
  statsCharts: chatManifest.statsCharts,
  // The project AI-history hub (#59) is chat functionality — sessions, journal
  // and usage all read /api/chat/* — so chat contributes it into the project
  // detail's tab slot (#58); the tab disappears with the chat plugin.
  contributions: [
    // Chat's verb in the home dashboard action strip (#90): open the assistant.
    {
      slot: 'dashboard.actions',
      component: ChatBenchAction,
      order: 40,
    },
    {
      slot: 'projects.detail.tabs',
      component: AiHistoryTab,
      meta: {
        tabId: 'ai',
        labelKey: 'projectDetail.tabs.ai',
        icon: Bot,
        // Pro surface (#269): hidden in simple mode unless re-enabled; the
        // host keeps a deep-linked tab rendering (same as logistics').
        visible: () => useUxMode().isFeatureVisible('chat.projectTab'),
      },
    },
  ],
  // Chat owns the AI-provider configuration — its settings surface.
  settings: {
    descriptionKey: chatManifest.descriptionKey,
    version: chatManifest.version,
    icon: chatManifest.icon,
    component: AiProviderSettings,
  },
});
