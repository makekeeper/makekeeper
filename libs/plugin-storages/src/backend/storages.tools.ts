import {
  AgentTool,
  PermissionLevel,
  formatObjectRef,
  parseCellAddress,
  resolveEntityId,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { PluginI18nService } from '@makekeeper/backend-core';
import { StoragesService } from './storages.service';

// Accept a raw storage id OR a canonical storage ORef, verifying ownership; a ref
// for any other plugin/type is a correctable error, not a silent wrong lookup (#16).
const toStorageId = (input: string, i18n: PluginI18nService): string => {
  const resolved = resolveEntityId(input, {
    pluginId: 'storages',
    entityType: 'storage',
  });
  if (!resolved) {
    throw new Error(
      i18n.t('storages.errors.invalidStorageRef', { ref: input }),
    );
  }
  return resolved.id;
};

// Best-effort id for display paths (confirmSummary) that must never throw: unwrap a
// storage ORef, else return the input unchanged.
const storageIdOf = (input: string): string =>
  resolveEntityId(input, { pluginId: 'storages', entityType: 'storage' })?.id ??
  input;

// Tag a storage row with its canonical ORef so the agent can refer back to it (and
// pass it into other tools) without reconstructing the reference itself.
const withStorageRef = <T extends { id: string }>(
  storage: T,
): T & { ref: string } => {
  const ref = formatObjectRef({
    pluginId: 'storages',
    entityType: 'storage',
    entityId: storage.id,
  });
  // A persisted id is always a valid entityId, so format never returns null here;
  // the guard keeps the types honest without a non-null assertion.
  return ref ? { ...storage, ref } : { ...storage, ref: '' };
};

export const getStorageTools = (
  storagesService: StoragesService,
  i18n: PluginI18nService,
): AgentTool[] =>
  withPlugin('storages', 'plugins.storages.name', [
    // ── READ ──────────────────────────────────────────────────────────────────

    {
      name: 'list_storages',
      descriptionKey: 'storages.agentTools.list_storages.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async () => {
        const storages = await storagesService.findAll();
        return storages.map(withStorageRef);
      },
    },

    {
      name: 'get_storage_details',
      descriptionKey: 'storages.agentTools.get_storage_details.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.get_storage_details.params.storageId',
          },
        },
        required: ['storageId'],
      },
      handler: async (args: { storageId: string }) => {
        const storage = await storagesService.findOne(
          toStorageId(args.storageId, i18n),
        );
        return storage ? withStorageRef(storage) : storage;
      },
    },

    {
      name: 'get_storage_components',
      descriptionKey: 'storages.agentTools.get_storage_components.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.get_storage_components.params.storageId',
          },
          cell: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.get_storage_components.params.cell',
          },
          row: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.get_storage_components.params.row',
          },
          col: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.get_storage_components.params.col',
          },
        },
        required: ['storageId'],
      },
      handler: async (args: {
        storageId: string;
        cell?: string;
        row?: number;
        col?: number;
      }) => {
        const cell =
          typeof args.cell === 'string'
            ? parseCellAddress(args.cell)
            : typeof args.row === 'number' && typeof args.col === 'number'
              ? { row: args.row, col: args.col }
              : undefined;
        return storagesService.getComponents(
          toStorageId(args.storageId, i18n),
          cell ?? undefined,
        );
      },
    },

    // ── WRITE ─────────────────────────────────────────────────────────────────

    {
      name: 'create_storage',
      descriptionKey: 'storages.agentTools.create_storage.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            descriptionKey: 'storages.agentTools.create_storage.params.name',
          },
          location: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.create_storage.params.location',
          },
          parentId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.create_storage.params.parentId',
          },
          parentCell: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.create_storage.params.parentCell',
          },
          parentRow: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.create_storage.params.parentRow',
          },
          parentCol: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.create_storage.params.parentCol',
          },
          gridRows: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.create_storage.params.gridRows',
          },
          gridCols: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.create_storage.params.gridCols',
          },
        },
        required: ['name'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.create_storage',
        params: { name: String(args.name) },
      }),
      handler: async (args: {
        name: string;
        location?: string;
        parentId?: string;
        parentCell?: string;
        parentRow?: number;
        parentCol?: number;
        gridRows?: number;
        gridCols?: number;
      }) => {
        const { parentCell, parentId, ...data } = args;
        const cell =
          typeof parentCell === 'string' ? parseCellAddress(parentCell) : null;
        if (typeof parentCell === 'string' && !cell) {
          throw new Error(
            i18n.t('storages.errors.invalidCellAddress', { cell: parentCell }),
          );
        }
        const resolvedParentId =
          parentId === undefined ? undefined : toStorageId(parentId, i18n);
        const base = { ...data, parentId: resolvedParentId };
        const storage = await storagesService.create(
          cell ? { ...base, parentRow: cell.row, parentCol: cell.col } : base,
        );
        return withStorageRef(storage);
      },
    },

    {
      name: 'update_storage',
      descriptionKey: 'storages.agentTools.update_storage.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.update_storage.params.storageId',
          },
          name: {
            type: 'string',
            descriptionKey: 'storages.agentTools.update_storage.params.name',
          },
          location: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.update_storage.params.location',
          },
          parentId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.update_storage.params.parentId',
          },
          parentCell: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.update_storage.params.parentCell',
          },
          parentRow: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.update_storage.params.parentRow',
          },
          parentCol: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.update_storage.params.parentCol',
          },
        },
        required: ['storageId'],
      },
      confirmSummary: async (args) => {
        const storage = await storagesService.findOne(
          storageIdOf(String(args.storageId)),
        );
        return {
          key: 'agentConfirm.update_storage',
          params: { name: storage?.name ?? String(args.storageId) },
        };
      },
      handler: async (args: {
        storageId: string;
        name?: string;
        location?: string;
        parentId?: string;
        parentCell?: string;
        parentRow?: number;
        parentCol?: number;
      }) => {
        const { storageId, parentCell, parentId, ...data } = args;
        const cell =
          typeof parentCell === 'string' ? parseCellAddress(parentCell) : null;
        if (typeof parentCell === 'string' && !cell) {
          throw new Error(
            i18n.t('storages.errors.invalidCellAddress', { cell: parentCell }),
          );
        }
        const resolvedParentId =
          parentId === undefined ? undefined : toStorageId(parentId, i18n);
        const base = { ...data, parentId: resolvedParentId };
        const storage = await storagesService.update(
          toStorageId(storageId, i18n),
          cell ? { ...base, parentRow: cell.row, parentCol: cell.col } : base,
        );
        return withStorageRef(storage);
      },
    },

    {
      name: 'update_storage_grid',
      descriptionKey: 'storages.agentTools.update_storage_grid.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.update_storage_grid.params.storageId',
          },
          rows: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.update_storage_grid.params.rows',
          },
          cols: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.update_storage_grid.params.cols',
          },
        },
        required: ['storageId', 'rows', 'cols'],
      },
      confirmSummary: async (args) => {
        const storage = await storagesService.findOne(
          storageIdOf(String(args.storageId)),
        );
        return {
          key: 'agentConfirm.update_storage_grid',
          params: {
            name: storage?.name ?? String(args.storageId),
            rows: String(Number(args.rows)),
            cols: String(Number(args.cols)),
          },
        };
      },
      handler: async (args: {
        storageId: string;
        rows: number;
        cols: number;
      }) => {
        const storage = await storagesService.update(
          toStorageId(args.storageId, i18n),
          {
            gridRows: args.rows,
            gridCols: args.cols,
          },
        );
        return withStorageRef(storage);
      },
    },

    {
      name: 'merge_storage_grid_cells',
      descriptionKey:
        'storages.agentTools.merge_storage_grid_cells.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.merge_storage_grid_cells.params.storageId',
          },
          startCell: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.merge_storage_grid_cells.params.startCell',
          },
          startRow: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.merge_storage_grid_cells.params.startRow',
          },
          startCol: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.merge_storage_grid_cells.params.startCol',
          },
          rowSpan: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.merge_storage_grid_cells.params.rowSpan',
          },
          colSpan: {
            type: 'number',
            descriptionKey:
              'storages.agentTools.merge_storage_grid_cells.params.colSpan',
          },
        },
        required: ['storageId', 'rowSpan', 'colSpan'],
      },
      confirmSummary: async (args) => {
        const storage = await storagesService.findOne(
          storageIdOf(String(args.storageId)),
        );
        return {
          key: 'agentConfirm.merge_storage_grid_cells',
          params: { name: storage?.name ?? String(args.storageId) },
        };
      },
      handler: async (args: {
        storageId: string;
        startCell?: string;
        startRow?: number;
        startCol?: number;
        rowSpan: number;
        colSpan: number;
      }) => {
        const start =
          typeof args.startCell === 'string'
            ? parseCellAddress(args.startCell)
            : typeof args.startRow === 'number' &&
                typeof args.startCol === 'number'
              ? { row: args.startRow, col: args.startCol }
              : null;
        if (!start) {
          throw new Error(i18n.t('storages.errors.missingRectangleStart'));
        }
        const storageId = toStorageId(args.storageId, i18n);
        const storage = await storagesService.findOne(storageId);
        if (!storage) {
          throw new Error(
            i18n.t('storages.errors.storageNotFound', {
              storageId,
            }),
          );
        }

        let spans: Array<{
          id: string;
          startRow: number;
          startCol: number;
          rowSpan: number;
          colSpan: number;
        }> = [];
        if (storage.gridSpans) {
          try {
            spans = JSON.parse(storage.gridSpans as string);
          } catch (e) {
            spans = [];
          }
        }

        const newSpan = {
          id: 'span_' + Math.random().toString(36).substring(2, 9),
          startRow: start.row,
          startCol: start.col,
          rowSpan: args.rowSpan,
          colSpan: args.colSpan,
        };
        spans.push(newSpan);

        return withStorageRef(
          await storagesService.update(storageId, {
            gridSpans: JSON.stringify(spans),
          }),
        );
      },
    },

    {
      name: 'split_storage_grid_cell',
      descriptionKey: 'storages.agentTools.split_storage_grid_cell.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.split_storage_grid_cell.params.storageId',
          },
          spanId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.split_storage_grid_cell.params.spanId',
          },
        },
        required: ['storageId', 'spanId'],
      },
      confirmSummary: async (args) => {
        const storage = await storagesService.findOne(
          storageIdOf(String(args.storageId)),
        );
        return {
          key: 'agentConfirm.split_storage_grid_cell',
          params: { name: storage?.name ?? String(args.storageId) },
        };
      },
      handler: async (args: { storageId: string; spanId: string }) => {
        const storageId = toStorageId(args.storageId, i18n);
        const storage = await storagesService.findOne(storageId);
        if (!storage) {
          throw new Error(
            i18n.t('storages.errors.storageNotFound', {
              storageId,
            }),
          );
        }

        let spans: Array<{ id: string }> = [];
        if (storage.gridSpans) {
          try {
            spans = JSON.parse(storage.gridSpans as string);
          } catch (e) {
            spans = [];
          }
        }

        spans = spans.filter((s) => s.id !== args.spanId);

        return withStorageRef(
          await storagesService.update(storageId, {
            gridSpans: JSON.stringify(spans),
          }),
        );
      },
    },

    // ── DESTRUCTIVE ───────────────────────────────────────────────────────────

    {
      name: 'delete_storage_cell',
      descriptionKey: 'storages.agentTools.delete_storage_cell.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          storageId: {
            type: 'string',
            descriptionKey:
              'storages.agentTools.delete_storage_cell.params.storageId',
          },
        },
        required: ['storageId'],
      },
      confirmSummary: async (args) => {
        const storage = await storagesService.findOne(
          storageIdOf(String(args.storageId)),
        );
        return {
          key: 'agentConfirm.delete_storage_cell',
          params: { name: storage?.name ?? String(args.storageId) },
        };
      },
      handler: async (args: { storageId: string }) => {
        return storagesService.delete(toStorageId(args.storageId, i18n));
      },
    },
  ]);
