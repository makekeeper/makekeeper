import {
  bindDashboardWidgets,
  registerPlugin,
} from '@makekeeper/frontend-core';
import { parseCellAddress } from '@makekeeper/plugin-contract';
import { storagesManifest } from '../manifest';
import StoragesStatWidget from './dashboard/StoragesStatWidget.vue';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import StoragesView from './StoragesView.vue';

registerPlugin({
  id: storagesManifest.id,
  nameKey: storagesManifest.nameKey,
  navigation: storagesManifest.navigation,
  messages: { en, ru },
  uxFeatures: storagesManifest.uxFeatures,
  dashboardWidgets: bindDashboardWidgets(storagesManifest.dashboardWidgets, {
    'storages.total': StoragesStatWidget,
  }),
  routes: [{ path: '/storages', name: 'storages', component: StoragesView }],
  // A storage ORef opens the storages screen with that storage selected; a cell
  // fragment ("#B1") is decoded to the row/col query the view reads for selection.
  refToRoute: (ref) => {
    if (ref.entityType !== 'storage') return null;
    const query: Record<string, string> = { storageId: ref.entityId };
    if (ref.fragment) {
      const cell = parseCellAddress(ref.fragment);
      if (cell) {
        query.row = String(cell.row);
        query.col = String(cell.col);
      }
    }
    return { path: '/storages', query };
  },
});
