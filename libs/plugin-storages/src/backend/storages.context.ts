import {
  PageContextResolver,
  formatCellAddress,
} from '@makekeeper/plugin-contract';
import { PluginI18nService } from '@makekeeper/backend-core';
import { StoragesService } from './storages.service';

// Server-side page-context resolver for the storages screen (issue #15). The
// frontend only sends raw route ids (query: storageId / row / col); everything
// human-readable — the storage name, its full path and the open cell address — is
// resolved HERE from the database. This is deliberately not done on the client:
// a stale browser bundle can send outdated prose, but it cannot fake these ids,
// so the agent always sees the true current selection.
export const createStoragesPageContextResolver = (
  storagesService: StoragesService,
  i18n: PluginI18nService,
): PageContextResolver => {
  return async (context) => {
    const query = context.query ?? {};
    const storageId = query['storageId'];
    if (!storageId) return null;

    const storages = await storagesService.findAll();
    const byId = new Map(storages.map((s) => [s.id, s]));
    const target = byId.get(storageId);
    if (!target) return null;

    // Root → target path, each nested hop tagged with the parent-grid cell it
    // occupies, mirroring the UI breadcrumbs: "Office / Working Table (A2)". The
    // same walk backs StoragesService.getBreadcrumb (used by the ORef resolver).
    const crumbs: string[] = [];
    let current = byId.get(storageId);
    // The parent chain is finite; the size guard only protects against a cyclic
    // parentId corruption in the data.
    for (let i = 0; current && i < storages.length; i++) {
      const placement = formatCellAddress(current.parentRow, current.parentCol);
      crumbs.unshift(
        placement ? `${current.name} (${placement})` : current.name,
      );
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const path = crumbs.join(' / ');

    const row = Number(query['row']);
    const col = Number(query['col']);
    const cell =
      Number.isInteger(row) && Number.isInteger(col)
        ? formatCellAddress(row, col)
        : null;

    if (cell) {
      return i18n.t('storages.pageContext.cellOpen', { path, storageId, cell });
    }
    return i18n.t('storages.pageContext.noCell', { path, storageId });
  };
};
