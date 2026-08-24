import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the chat plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
export const chatManifest: PluginManifest = {
  id: 'chat',
  nameKey: 'plugins.chat.name',
  descriptionKey: 'plugins.chat.description',
  version: '1.0.0',
  icon: 'Bot',
  // Chat sessions are user-private (never shared) — chatting stays available
  // inside read-only shared scopes.
  readOnlyScopeExempt: true,
  navigation: [],
  // Blocks published to the home dashboard; components bound in frontend/index.ts.
  dashboardWidgets: [
    // Telemetry widgets follow the pro lens (#269) — the assistant itself
    // stays basic, its usage/provider breakdowns are power-user reading. Each
    // is overridable in settings by its own widget key, like the rows chart.
    {
      key: 'chat.activity',
      titleKey: 'chat.dashboard.activity',
      icon: 'Bot',
      size: 'panel',
      order: 91,
      advanced: true,
    },
    // Provider-usage widget (demo data until the collection ticket lands).
    // The chosen chart design; the discarded prototype variants are archived
    // in the project wiki ("Chart examples — provider usage prototypes").
    // Keyed to the stats chart of the same name (#269): provider usage is one
    // feature on two screens, so it must offer one switch, not two rows
    // labelled "AI providers".
    {
      key: 'chat.providerUsage',
      titleKey: 'chat.dashboard.proto.rowsTitle',
      icon: 'Bot',
      size: 'panel',
      order: 92,
      advanced: true,
    },
  ],
  // The project detail's AI tab (#269): history/journal/usage telemetry is a
  // pro surface; the assistant panel and its dashboard verb stay basic.
  uxFeatures: [{ key: 'chat.projectTab', labelKey: 'chat.ux.projectTab' }],
  // Statistics this plugin supplies to the stats plugin (ticket #56). The pilot
  // metric: human messages per day. The backend registers a matching provider
  // in chat.module.ts; the stats plugin aggregates and serves it.
  statsProviders: [
    {
      key: 'chat.messages',
      labelKey: 'chat.stats.messages.label',
      unitKey: 'chat.stats.messages.unit',
      kind: 'counter',
    },
    // Provider usage telemetry (ticket #55): per-day requests / tokens / errors,
    // broken down by provider + model. Aggregated from AIUsageEvent.
    {
      key: 'chat.usage.requests',
      labelKey: 'chat.stats.usage.requests',
      unitKey: 'chat.stats.usage.requestsUnit',
      kind: 'counter',
      dimensions: ['provider', 'model'],
    },
    {
      key: 'chat.usage.tokens',
      labelKey: 'chat.stats.usage.tokens',
      unitKey: 'chat.stats.usage.tokensUnit',
      kind: 'counter',
      dimensions: ['provider', 'model'],
    },
    {
      key: 'chat.usage.errors',
      labelKey: 'chat.stats.usage.errors',
      unitKey: 'chat.stats.usage.errorsUnit',
      kind: 'counter',
      dimensions: ['provider', 'model'],
    },
  ],
  // The chart the stats plugin builds from that metric (declarative; the stats
  // plugin owns the rendering).
  statsCharts: [
    {
      kind: 'series',
      key: 'chat.messagesActivity',
      titleKey: 'chat.stats.messagesActivity.title',
      form: 'area',
      series: [
        {
          metricKey: 'chat.messages',
          labelKey: 'chat.stats.messages.seriesLabel',
        },
      ],
      defaultRangeDays: 14,
    },
    // Per-provider usage rows: requests + tokens lines with error bars, one row
    // per provider+model (the ProvidersRowsWidget renders this `rows` form).
    {
      kind: 'series',
      key: 'chat.providerUsage',
      titleKey: 'chat.stats.usage.title',
      form: 'rows',
      series: [
        {
          metricKey: 'chat.usage.requests',
          labelKey: 'chat.stats.usage.requests',
        },
        { metricKey: 'chat.usage.tokens', labelKey: 'chat.stats.usage.tokens' },
        { metricKey: 'chat.usage.errors', labelKey: 'chat.stats.usage.errors' },
      ],
      splitByDimension: 'provider',
      defaultRangeDays: 14,
      // Detailed telemetry — advanced by default, re-enableable per-user.
      advanced: true,
    },
  ],
  // Exchange section (#62): the project's AI chat history with message-image
  // attachments. Usage telemetry never travels with an entity export.
  exchange: {
    sections: [
      {
        key: 'chat.sessions',
        labelKey: 'chat.exchange.sections.sessions',
        roots: ['project'],
        dependsOn: ['projects.project'],
        hasFiles: true,
      },
      // Instance backup: sessions, messages and usage telemetry.
      {
        key: 'chat.all',
        labelKey: 'chat.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        dependsOn: ['projects.all'],
      },
      // LLM provider connections incl. API keys — include-secrets only.
      {
        key: 'chat.providers',
        labelKey: 'chat.exchange.sections.providers',
        roots: [EXCHANGE_INSTANCE_ROOT],
        sensitive: true,
      },
    ],
  },
};
