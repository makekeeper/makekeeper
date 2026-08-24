import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the projects plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
export const projectsManifest: PluginManifest = {
  id: 'projects',
  nameKey: 'plugins.projects.name',
  descriptionKey: 'plugins.projects.description',
  version: '1.0.0',
  icon: 'FolderGit',
  navigation: [
    {
      path: '/projects',
      titleKey: 'nav.projects',
      icon: 'FolderGit',
      section: 'main',
      // The scope's project groups, resolved at runtime (#288). The shell
      // renders whatever the provider returns; the provider itself is bound in
      // the frontend registration.
      childrenProvider: 'projects.groups',
    },
  ],
  // Advanced surfaces hidden in simple UX mode (#53) — a display lens only;
  // the frontend registration passes these through to the settings toggles.
  uxFeatures: [
    {
      key: 'projects.fullStatuses',
      labelKey: 'projects.uxFeatures.fullStatuses',
    },
    {
      key: 'projects.listFilters',
      labelKey: 'projects.uxFeatures.listFilters',
    },
    { key: 'projects.specsCard', labelKey: 'projects.uxFeatures.specsCard' },
    // Project groups (#289): in simple mode a project just lives in General —
    // the sidebar does not expand, the groups page is unreachable and the form
    // field is hidden (while keeping the project's loaded group).
    { key: 'projects.groups', labelKey: 'projects.uxFeatures.groups' },
    {
      key: 'projects.budgetPlanning',
      labelKey: 'projects.uxFeatures.budgetPlanning',
    },
    {
      key: 'projects.reservations',
      labelKey: 'projects.uxFeatures.reservations',
    },
    {
      key: 'projects.taskAdvanced',
      labelKey: 'projects.uxFeatures.taskAdvanced',
    },
    // The two charts the bench composes itself (status donut + activity
    // heatmap) — one key for the pair (#269): they share the lower bench's
    // left column, and hiding one of two would leave a lopsided grid.
    {
      key: 'projects.benchCharts',
      labelKey: 'projects.uxFeatures.benchCharts',
    },
    // The timeline (#294). Planning by dates is the part of project management
    // simple mode deliberately sets aside, so the third view button is hidden
    // there — and a `?view=gantt` link falls back to the grid.
    { key: 'projects.gantt', labelKey: 'projects.uxFeatures.gantt' },
  ],
  // Blocks published to the home dashboard; components bound in frontend/index.ts.
  dashboardWidgets: [
    // The bench (#90): the dashboard hero — one active project in focus + the
    // cross-project task queue. Full-width, pinned above the stats row.
    {
      key: 'projects.bench',
      titleKey: 'projects.bench.title',
      icon: 'Hammer',
      size: 'hero',
      order: 0,
    },
    // Under the UX lens (#269): the bench's own ribbon already carries this
    // count, which is why the tiles moved off the top row — so simple mode
    // drops the tile and keeps the ribbon.
    {
      key: 'projects.activeCount',
      titleKey: 'projects.dashboard.activeProjects',
      icon: 'FolderGit',
      size: 'stat',
      order: 10,
      advanced: true,
    },
    // NOTE: the project-status donut and the activity heatmap are NOT registered
    // as standalone dashboard widgets — the bench hero (#90) composes them itself,
    // stacked beside the task queue (see BenchWidget.vue).
  ],
  // Real project-activity statistics (ticket #54). The backend registers a
  // matching provider; the stats plugin aggregates daily counts (dimensioned by
  // projectId) and serves them to the dashboard + per-project heatmap.
  statsProviders: [
    {
      key: 'projects.activity',
      labelKey: 'projects.stats.activity.label',
      unitKey: 'projects.stats.activity.unit',
      kind: 'counter',
      dimensions: ['projectId'],
    },
  ],
  // Export/import declarations (#62): the `project` entity root plus the
  // sections this plugin provides. `runAfter` orders task links behind the
  // sections their targets come from without requiring them.
  exchange: {
    roots: [
      {
        kind: 'entity',
        entityType: 'project',
        labelKey: 'projects.exchange.root',
        icon: 'FolderGit',
      },
    ],
    sections: [
      {
        key: 'projects.project',
        labelKey: 'projects.exchange.sections.project',
        roots: ['project'],
        isRoot: true,
        hasFiles: true,
      },
      {
        key: 'projects.tasks',
        labelKey: 'projects.exchange.sections.tasks',
        roots: ['project'],
        dependsOn: ['projects.project'],
        runAfter: ['inventory.components', 'logistics.orders'],
      },
      {
        key: 'projects.activity',
        labelKey: 'projects.exchange.sections.activity',
        roots: ['project'],
        dependsOn: ['projects.project'],
      },
      // Instance backup: whole-table dumps in FK-safe order. Task↔order links
      // live in their own section because they need logistics restored first.
      {
        key: 'projects.all',
        labelKey: 'projects.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        dependsOn: ['inventory.all'],
      },
      {
        key: 'projects.taskOrders',
        labelKey: 'projects.exchange.sections.taskOrders',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        dependsOn: ['projects.all', 'logistics.all'],
      },
    ],
  },
  statsCharts: [
    {
      kind: 'series',
      key: 'projects.activityCalendar',
      titleKey: 'projects.stats.activity.title',
      form: 'heatmapCalendar',
      series: [
        {
          metricKey: 'projects.activity',
          labelKey: 'projects.stats.activity.label',
        },
      ],
      defaultRangeDays: 365,
    },
  ],
  core: true,
};
