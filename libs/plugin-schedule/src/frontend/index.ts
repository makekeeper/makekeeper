import { registerPlugin } from '@makekeeper/frontend-core';
import { scheduleManifest } from '../manifest';
import CalendarView from './CalendarView.vue';
import InboxComposeAction from './InboxComposeAction.vue';
import RemindSlotAction from './RemindSlotAction.vue';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

// Two surfaces: the calendar screen (#310) and the reminder a person sets on
// the object in front of them — or on nothing at all (#313).
registerPlugin({
  id: scheduleManifest.id,
  nameKey: scheduleManifest.nameKey,
  navigation: scheduleManifest.navigation,
  messages: { en, ru },
  routes: [{ path: '/calendar', name: 'calendar', component: CalendarView }],
  // One predictable place on every page that names its entity, instead of a
  // button negotiated with each host plugin (§5.10).
  contributions: [
    { slot: 'page.header.actions', component: RemindSlotAction },
    // The inbox offers what it is an inbox for (#315): in its empty state,
    // and on a footer line when it has something in it.
    { slot: 'notify.inbox.actions', component: InboxComposeAction },
  ],
});
