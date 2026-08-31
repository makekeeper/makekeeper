import { PluginManifest } from '@makekeeper/plugin-contract';

// Identity of the scheduler (#308/#310): the engine that fires at a moment, and
// the calendar that shows what is coming — a read projection over the plugins
// that own the dates, never a table of its own.
export const scheduleManifest: PluginManifest = {
  id: 'schedule',
  nameKey: 'plugins.schedule.name',
  descriptionKey: 'plugins.schedule.description',
  version: '1.0.0',
  icon: 'CalendarClock',
  // One place that answers "what is coming": the plugin's own screen, built
  // entirely from what other plugins already hold (#310).
  navigation: [
    {
      path: '/calendar',
      titleKey: 'nav.calendar',
      icon: 'CalendarClock',
      section: 'main',
    },
  ],
};
