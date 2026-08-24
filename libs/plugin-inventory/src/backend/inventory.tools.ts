import {
  AgentTool,
  PermissionLevel,
  defineTools,
  formatCellAddress,
  formatObjectRef,
  parseCellAddress,
  resolveEntityId,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { PluginI18nService } from '@makekeeper/backend-core';
import { InventoryService } from './inventory.service';
import { InventoryStockService } from './inventory-stock.service';
import { InventoryCategoriesService } from './categories.service';
import {
  CATEGORY_PROPERTY_TYPES,
  isCategoryPropertyType,
  type CategoryPropertyType,
} from '../categories';
import { MANUAL_MOVEMENT_TYPES, ManualMovementType } from './inventory.dto';
import { MAX_ITEM_PHOTOS } from '../photos';

// Narrow a raw tool argument to a valid manual movement type; anything else
// falls back to the service default (ADJUSTMENT).
export const isManualMovementType = (
  value: unknown,
): value is ManualMovementType =>
  typeof value === 'string' &&
  MANUAL_MOVEMENT_TYPES.some((type) => type === value);

// Tag a component row with its human grid address AND its canonical ORef, so the
// agent reads both instead of (mis)computing the address from storageRow/storageCol
// or reconstructing the reference itself.
const withAddress = <
  T extends {
    id: string;
    storageRow: number | null;
    storageCol: number | null;
  },
>(
  component: T,
): T & { cellAddress: string | null; ref: string } => {
  const ref = formatObjectRef({
    pluginId: 'inventory',
    entityType: 'component',
    entityId: component.id,
  });
  return {
    ...component,
    cellAddress: formatCellAddress(component.storageRow, component.storageCol),
    // A persisted id always yields a valid ORef; the fallback keeps types honest.
    ref: ref ?? '',
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The agent passes links as an array of { label, url }; the model persists them
// as a JSON string (the same shape the create form produces). Coerce defensively,
// drop incomplete rows, and return undefined when nothing usable remains so the
// service's default ('') applies instead of storing "[]".
export const stringifyLinks = (input: unknown): string | undefined => {
  if (!Array.isArray(input)) return undefined;
  const links = input
    .filter(isRecord)
    .map((entry) => ({
      label: String(entry.label ?? ''),
      url: String(entry.url ?? ''),
    }))
    .filter((link) => link.label.trim() !== '' && link.url.trim() !== '');
  return links.length ? JSON.stringify(links) : undefined;
};

// The item's photograph set as the agent supplies it (#218): stored
// "/api/uploads/:id" URLs, in order, first entry the cover.
//
// `undefined` (no argument) means "leave the pictures alone"; an EMPTY array is
// a real instruction — clear them — which is what an empty `imageUrl` string
// meant before the parameter became a list. Blank entries are dropped so a
// model padding the array cannot silently shorten the set it thought it sent.
// Capping here rather than throwing keeps a create with six URLs from failing
// outright; the service caps too, because it is the one that must not be lied
// to.
export const readImageUrls = (input: unknown): string[] | undefined => {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) return undefined;
  return input
    .map((entry) => String(entry).trim())
    .filter((url) => url !== '')
    .slice(0, MAX_ITEM_PHOTOS);
};

// Same contract as stringifyLinks for custom characteristics ({ key, value }).
export const stringifyCustomFields = (input: unknown): string | undefined => {
  if (!Array.isArray(input)) return undefined;
  const fields = input
    .filter(isRecord)
    .map((entry) => ({
      key: String(entry.key ?? ''),
      value: String(entry.value ?? ''),
    }))
    .filter((field) => field.key.trim() !== '' && field.value.trim() !== '');
  return fields.length ? JSON.stringify(fields) : undefined;
};

// Accept a raw component id OR a canonical component ORef, verifying ownership; a
// ref for another plugin/type is a correctable error, not a wrong lookup (#16).
const toComponentId = (input: string, i18n: PluginI18nService): string => {
  const resolved = resolveEntityId(input, {
    pluginId: 'inventory',
    entityType: 'component',
  });
  if (!resolved) {
    throw new Error(
      i18n.t('inventory.errors.invalidComponentRef', { ref: input }),
    );
  }
  return resolved.id;
};

// Best-effort component id for display paths (confirmSummary) that must not throw.
const componentIdOf = (input: string): string =>
  resolveEntityId(input, { pluginId: 'inventory', entityType: 'component' })
    ?.id ?? input;

// Accept a raw storage id OR a storages ORef where a component points at a storage.
const toStorageId = (input: string, i18n: PluginI18nService): string => {
  const resolved = resolveEntityId(input, {
    pluginId: 'storages',
    entityType: 'storage',
  });
  if (!resolved) {
    throw new Error(
      i18n.t('inventory.errors.invalidStorageRef', { ref: input }),
    );
  }
  return resolved.id;
};

// Resolve a cell given either an address string ("B1", preferred) or a raw
// row/col pair. Throws on a malformed address so the agent gets a correctable
// error instead of a silent misplacement.
const resolveCell = (
  args: {
    cell?: string;
    row?: number;
    col?: number;
  },
  i18n: PluginI18nService,
): { row: number; col: number } | null => {
  if (typeof args.cell === 'string') {
    const cell = parseCellAddress(args.cell);
    if (!cell) {
      throw new Error(
        i18n.t('inventory.errors.malformedCell', { cell: args.cell }),
      );
    }
    return cell;
  }
  if (typeof args.row === 'number' && typeof args.col === 'number') {
    return { row: args.row, col: args.col };
  }
  return null;
};

// Accept a raw category id OR a canonical category ORef, like components (#16).
const toCategoryId = (input: string, i18n: PluginI18nService): string => {
  const resolved = resolveEntityId(input, {
    pluginId: 'inventory',
    entityType: 'category',
  });
  if (!resolved) {
    throw new Error(
      i18n.t('inventory.errors.invalidCategoryRef', { ref: input }),
    );
  }
  return resolved.id;
};

// The canonical name of a category, and of one property of it (§5.9). A
// property is a fragment of its category rather than an entity of its own: it
// has no meaning away from the category that declares it.
const categoryRef = (id: string): string | null =>
  formatObjectRef({
    pluginId: 'inventory',
    entityType: 'category',
    entityId: id,
  });

const withCategoryRef = <T extends { id: string }>(
  category: T,
): T & { ref: string | null } => ({
  ...category,
  ref: categoryRef(category.id),
});

const withPropertyRef = <T extends { id: string; categoryId: string }>(
  property: T,
): T & { ref: string | null } => ({
  ...property,
  ref: formatObjectRef({
    pluginId: 'inventory',
    entityType: 'category',
    entityId: property.categoryId,
    fragment: property.id,
  }),
});

// Property values arrive as a plain `{ propertyId: value }` map. Anything that
// is not a string/number is dropped here; anything the item's category does not
// define is dropped by the service. Both are silent on purpose — a model that
// invented a field should not be able to fail the write a human asked for.
const readPropertyValues = (
  input: unknown,
): Record<string, string | number | null> | undefined => {
  if (!isRecord(input)) return undefined;
  const values: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) values[key] = null;
    else if (typeof value === 'string' || typeof value === 'number')
      values[key] = value;
  }
  return Object.keys(values).length ? values : undefined;
};

export const getInventoryTools = (
  inventoryService: InventoryService,
  stockService: InventoryStockService,
  categoriesService: InventoryCategoriesService,
  i18n: PluginI18nService,
): AgentTool[] =>
  withPlugin('inventory', 'plugins.inventory.name', [
    // ── READ ──────────────────────────────────────────────────────────────────
    // Declared through `defineTools`: the tool + parameter descriptionKeys are
    // derived from `inventory.agentTools.<name>[.params.<param>]` instead of
    // re-typed here (the resolve-check in inventory.tools.spec proves they exist).
    ...defineTools('inventory.agentTools', [
      {
        name: 'list_components',
        permission: PermissionLevel.READ,
        // Server-side free-text search (#33 E5): matches name/SKU/description/
        // category/custom fields. Omit to list everything.
        params: { query: { type: 'string', optional: true } },
        handler: async (args) => {
          const components = await inventoryService.findAll(
            args.query === undefined ? undefined : String(args.query),
          );
          return components.map(withAddress);
        },
      },
      {
        name: 'find_components_by_sku',
        permission: PermissionLevel.READ,
        params: { sku: { type: 'string' } },
        // Soft duplicate lookup by exact SKU (#33 E4) — lets the agent check for
        // an existing part before creating one. Each hit carries its ORef.
        handler: async (args) => {
          const matches = await inventoryService.findBySku(String(args.sku));
          return matches.map((match) => ({
            ...match,
            ref:
              formatObjectRef({
                pluginId: 'inventory',
                entityType: 'component',
                entityId: match.id,
              }) ?? '',
          }));
        },
      },
      {
        name: 'list_restock_needed',
        permission: PermissionLevel.READ,
        handler: async () => {
          const components = await inventoryService.getRestockList();
          return components.map(withAddress);
        },
      },
      {
        name: 'get_component_movements',
        permission: PermissionLevel.READ,
        params: { componentId: { type: 'string' } },
        handler: async (args) =>
          inventoryService.findMovements(
            toComponentId(String(args.componentId), i18n),
          ),
      },
    ]),

    // ── WRITE ─────────────────────────────────────────────────────────────────

    // Project-stock tools (#58) — moved from the projects plugin: reserving,
    // consuming and returning stock are inventory functionality, so the tools
    // disappear with the plugin.
    {
      name: 'reserve_component',
      descriptionKey: 'inventory.agentTools.reserve_component.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.reserve_component.params.projectId',
          },
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.reserve_component.params.componentId',
          },
          qty: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.reserve_component.params.qty',
          },
        },
        required: ['projectId', 'componentId', 'qty'],
      },
      confirmSummary: async (args) => {
        const componentId = toComponentId(String(args.componentId), i18n);
        const [projectTitle, component] = await Promise.all([
          stockService.projectTitle(String(args.projectId)),
          inventoryService.findOne(componentId),
        ]);
        return {
          key: 'agentConfirm.reserve_component',
          params: {
            qty: String(Number(args.qty)),
            component: component?.name ?? componentId,
            project: projectTitle,
          },
        };
      },
      handler: async (args) =>
        stockService.reserveForProject(
          String(args.projectId),
          toComponentId(String(args.componentId), i18n),
          Number(args.qty),
        ),
    },

    {
      name: 'consume_component',
      descriptionKey: 'inventory.agentTools.consume_component.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.consume_component.params.projectId',
          },
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.consume_component.params.componentId',
          },
          qty: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.consume_component.params.qty',
          },
        },
        required: ['projectId', 'componentId', 'qty'],
      },
      confirmSummary: async (args) => {
        const componentId = toComponentId(String(args.componentId), i18n);
        const [projectTitle, component] = await Promise.all([
          stockService.projectTitle(String(args.projectId)),
          inventoryService.findOne(componentId),
        ]);
        return {
          key: 'agentConfirm.consume_component',
          params: {
            qty: String(Number(args.qty)),
            component: component?.name ?? componentId,
            project: projectTitle,
          },
        };
      },
      handler: async (args) =>
        stockService.consumeForProject(
          String(args.projectId),
          toComponentId(String(args.componentId), i18n),
          Number(args.qty),
        ),
    },

    {
      name: 'return_component',
      descriptionKey: 'inventory.agentTools.return_component.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.return_component.params.projectId',
          },
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.return_component.params.componentId',
          },
          qty: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.return_component.params.qty',
          },
        },
        required: ['projectId', 'componentId', 'qty'],
      },
      confirmSummary: async (args) => {
        const componentId = toComponentId(String(args.componentId), i18n);
        const [projectTitle, component] = await Promise.all([
          stockService.projectTitle(String(args.projectId)),
          inventoryService.findOne(componentId),
        ]);
        return {
          key: 'agentConfirm.return_component',
          params: {
            qty: String(Number(args.qty)),
            component: component?.name ?? componentId,
            project: projectTitle,
          },
        };
      },
      handler: async (args) =>
        stockService.returnForProject(
          String(args.projectId),
          toComponentId(String(args.componentId), i18n),
          Number(args.qty),
        ),
    },

    {
      name: 'create_component',
      descriptionKey: 'inventory.agentTools.create_component.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.create_component.params.name',
          },
          categoryId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.create_component.params.categoryId',
          },
          propertyValues: {
            type: 'object',
            descriptionKey:
              'inventory.agentTools.create_component.params.propertyValues',
          },
          quantity: {
            type: 'number',
            descriptionKey:
              'inventory.agentTools.create_component.params.quantity',
          },
          minQuantity: {
            type: 'number',
            descriptionKey:
              'inventory.agentTools.create_component.params.minQuantity',
          },
          unit: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.create_component.params.unit',
          },
          sku: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.create_component.params.sku',
          },
          description: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.create_component.params.description',
          },
          imageUrls: {
            type: 'array',
            descriptionKey:
              'inventory.agentTools.create_component.params.imageUrls',
            items: {
              type: 'string',
              descriptionKey:
                'inventory.agentTools.create_component.params.imageUrlItem',
            },
          },
          links: {
            type: 'array',
            descriptionKey:
              'inventory.agentTools.create_component.params.links',
            items: {
              type: 'object',
              descriptionKey:
                'inventory.agentTools.create_component.params.linkItem',
            },
          },
          customFields: {
            type: 'array',
            descriptionKey:
              'inventory.agentTools.create_component.params.customFields',
            items: {
              type: 'object',
              descriptionKey:
                'inventory.agentTools.create_component.params.customFieldItem',
            },
          },
          storageId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.create_component.params.storageId',
          },
          cell: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.create_component.params.cell',
          },
          row: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.create_component.params.row',
          },
          col: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.create_component.params.col',
          },
        },
        required: ['name'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.create_component',
        params: { name: String(args.name) },
      }),
      handler: async (args) => {
        const cell = resolveCell(
          {
            cell: args.cell === undefined ? undefined : String(args.cell),
            row: args.row === undefined ? undefined : Number(args.row),
            col: args.col === undefined ? undefined : Number(args.col),
          },
          i18n,
        );
        if (cell && args.storageId === undefined) {
          throw new Error(i18n.t('inventory.errors.storageIdRequired'));
        }
        const photos = readImageUrls(args.imageUrls);
        // Every URL, before anything is written (#218). A new item owns none of
        // them yet, hence the null.
        if (photos) await inventoryService.assertPhotosAdoptable(photos, null);
        const component = await inventoryService.create({
          name: String(args.name),
          categoryId:
            args.categoryId === undefined
              ? undefined
              : toCategoryId(String(args.categoryId), i18n),
          propertyValues: readPropertyValues(args.propertyValues),
          quantity:
            args.quantity === undefined ? undefined : Number(args.quantity),
          minQuantity:
            args.minQuantity === undefined
              ? undefined
              : Number(args.minQuantity),
          unit: args.unit === undefined ? undefined : String(args.unit),
          sku: args.sku === undefined ? undefined : String(args.sku),
          description:
            args.description === undefined
              ? undefined
              : String(args.description),
          // The list IS the item's photograph set (#218), first entry the cover.
          // Provenance was checked above, per URL: the model cannot slip an
          // invented or borrowed picture in beside a legitimate one, which the
          // turn-level #72 gate alone would have waved through.
          photos,
          links: stringifyLinks(args.links),
          customFields: stringifyCustomFields(args.customFields),
          storageId:
            args.storageId === undefined
              ? undefined
              : toStorageId(String(args.storageId), i18n),
          storageRow: cell?.row,
          storageCol: cell?.col,
        });
        return withAddress(component);
      },
    },

    {
      name: 'move_component',
      descriptionKey: 'inventory.agentTools.move_component.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.move_component.params.componentId',
          },
          storageId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.move_component.params.storageId',
          },
          cell: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.move_component.params.cell',
          },
          row: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.move_component.params.row',
          },
          col: {
            type: 'number',
            descriptionKey: 'inventory.agentTools.move_component.params.col',
          },
          clearCell: {
            type: 'boolean',
            descriptionKey:
              'inventory.agentTools.move_component.params.clearCell',
          },
        },
        required: ['componentId'],
      },
      confirmSummary: async (args) => {
        const comp = await inventoryService.findOne(
          componentIdOf(String(args.componentId)),
        );
        return {
          key: 'agentConfirm.move_component',
          params: { name: comp?.name ?? String(args.componentId) },
        };
      },
      handler: async (args) => {
        const cell = resolveCell(
          {
            cell: args.cell === undefined ? undefined : String(args.cell),
            row: args.row === undefined ? undefined : Number(args.row),
            col: args.col === undefined ? undefined : Number(args.col),
          },
          i18n,
        );
        const clearCell = args.clearCell === true;
        if (!cell && !clearCell && args.storageId === undefined) {
          throw new Error(i18n.t('inventory.errors.moveTargetRequired'));
        }
        const component = await inventoryService.update(
          toComponentId(String(args.componentId), i18n),
          {
            storageId:
              args.storageId === undefined
                ? undefined
                : toStorageId(String(args.storageId), i18n),
            // null clears the placement; undefined leaves it untouched.
            storageRow: clearCell ? null : cell?.row,
            storageCol: clearCell ? null : cell?.col,
          },
        );
        return withAddress(component);
      },
    },

    {
      name: 'update_component',
      descriptionKey: 'inventory.agentTools.update_component.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_component.params.componentId',
          },
          name: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.update_component.params.name',
          },
          sku: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.update_component.params.sku',
          },
          description: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_component.params.description',
          },
          categoryId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_component.params.categoryId',
          },
          propertyValues: {
            type: 'object',
            descriptionKey:
              'inventory.agentTools.update_component.params.propertyValues',
          },
          minQuantity: {
            type: 'number',
            descriptionKey:
              'inventory.agentTools.update_component.params.minQuantity',
          },
          unit: {
            type: 'string',
            descriptionKey: 'inventory.agentTools.update_component.params.unit',
          },
          imageUrls: {
            type: 'array',
            descriptionKey:
              'inventory.agentTools.update_component.params.imageUrls',
            items: {
              type: 'string',
              descriptionKey:
                'inventory.agentTools.update_component.params.imageUrlItem',
            },
          },
        },
        required: ['componentId'],
      },
      confirmSummary: async (args) => {
        const comp = await inventoryService.findOne(
          componentIdOf(String(args.componentId)),
        );
        return {
          key: 'agentConfirm.update_component',
          params: { name: comp?.name ?? String(args.componentId) },
        };
      },
      handler: async (args) => {
        // Only the provided fields are forwarded; Prisma treats `undefined` as
        // "leave unchanged", so unspecified attributes are never clobbered.
        // Quantity (adjust_component_quantity) and placement (move_component)
        // are intentionally out of scope — they have movement-/cell-aware tools.
        const data: Parameters<InventoryService['update']>[1] = {};
        if (args.name !== undefined) data.name = String(args.name);
        if (args.sku !== undefined) data.sku = String(args.sku);
        if (args.description !== undefined)
          data.description = String(args.description);
        // An empty string detaches the item from every category; its values
        // spill into the free-form pairs rather than vanishing (#205).
        if (args.categoryId !== undefined)
          data.categoryId =
            String(args.categoryId).trim() === ''
              ? null
              : toCategoryId(String(args.categoryId), i18n);
        const propertyValues = readPropertyValues(args.propertyValues);
        if (propertyValues) data.propertyValues = propertyValues;
        if (args.minQuantity !== undefined)
          data.minQuantity = Number(args.minQuantity);
        if (args.unit !== undefined) data.unit = String(args.unit);
        // The list REPLACES the item's photograph set — the semantics the old
        // single `imageUrl` had, kept recognisable — and an EMPTY list clears
        // it, which is what an empty `imageUrl` string used to mean. Entries are
        // already-stored "/api/uploads/:id" URLs.
        const imageUrls = readImageUrls(args.imageUrls);
        if (imageUrls !== undefined) data.photos = imageUrls;
        const componentId = toComponentId(String(args.componentId), i18n);
        // Every URL, before anything is written (#218). The item's OWN pictures
        // pass, so re-sending the current set to reorder it is not a violation;
        // an invented one, or one belonging elsewhere, fails the whole call
        // rather than being dropped behind a "updated" answer.
        if (imageUrls) {
          await inventoryService.assertPhotosAdoptable(imageUrls, componentId);
        }
        const component = await inventoryService.update(componentId, data);
        return withAddress(component);
      },
    },

    {
      name: 'adjust_component_quantity',
      descriptionKey:
        'inventory.agentTools.adjust_component_quantity.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.adjust_component_quantity.params.componentId',
          },
          amount: {
            type: 'number',
            descriptionKey:
              'inventory.agentTools.adjust_component_quantity.params.amount',
          },
          type: {
            type: 'string',
            enum: [...MANUAL_MOVEMENT_TYPES],
            descriptionKey:
              'inventory.agentTools.adjust_component_quantity.params.type',
          },
          note: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.adjust_component_quantity.params.note',
          },
        },
        required: ['componentId', 'amount'],
      },
      confirmSummary: async (args) => {
        const comp = await inventoryService.findOne(
          componentIdOf(String(args.componentId)),
        );
        const amount = Number(args.amount);
        // Show the sign explicitly so "+5" / "-2" reads unambiguously in the card.
        return {
          key: 'agentConfirm.adjust_component_quantity',
          params: {
            name: comp?.name ?? String(args.componentId),
            amount: amount > 0 ? `+${amount}` : String(amount),
          },
        };
      },
      handler: async (args) =>
        inventoryService.adjustQty(
          toComponentId(String(args.componentId), i18n),
          Number(args.amount),
          isManualMovementType(args.type) ? args.type : undefined,
          args.note === undefined ? undefined : String(args.note),
        ),
    },

    // ── Categories & properties (#205) ────────────────────────────────────────

    {
      name: 'list_item_categories',
      descriptionKey: 'inventory.agentTools.list_item_categories.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const categories = await categoriesService.list();
        return categories.map((category) => ({
          ...withCategoryRef(category),
          properties: category.properties.map(withPropertyRef),
        }));
      },
    },

    {
      name: 'create_item_category',
      descriptionKey: 'inventory.agentTools.create_item_category.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.create_item_category.params.name',
          },
          parentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.create_item_category.params.parentId',
          },
          inheritProperties: {
            type: 'boolean',
            descriptionKey:
              'inventory.agentTools.create_item_category.params.inheritProperties',
          },
        },
        required: ['name'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.create_item_category',
        params: { name: String(args.name) },
      }),
      handler: async (args) =>
        withCategoryRef(
          await categoriesService.createCategory({
            name: String(args.name),
            parentId:
              args.parentId === undefined
                ? undefined
                : toCategoryId(String(args.parentId), i18n),
            inheritProperties:
              args.inheritProperties === undefined
                ? undefined
                : Boolean(args.inheritProperties),
          }),
        ),
    },

    {
      name: 'update_item_category',
      descriptionKey: 'inventory.agentTools.update_item_category.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          categoryId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_item_category.params.categoryId',
          },
          name: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_item_category.params.name',
          },
          parentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_item_category.params.parentId',
          },
          inheritProperties: {
            type: 'boolean',
            descriptionKey:
              'inventory.agentTools.update_item_category.params.inheritProperties',
          },
        },
        required: ['categoryId'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.update_item_category',
        params: { name: String(args.name ?? args.categoryId) },
      }),
      handler: async (args) =>
        withCategoryRef(
          await categoriesService.updateCategory(
            toCategoryId(String(args.categoryId), i18n),
            {
              name: args.name === undefined ? undefined : String(args.name),
              // An empty string detaches the category to the root.
              parentId:
                args.parentId === undefined
                  ? undefined
                  : String(args.parentId).trim() === ''
                    ? null
                    : toCategoryId(String(args.parentId), i18n),
              inheritProperties:
                args.inheritProperties === undefined
                  ? undefined
                  : Boolean(args.inheritProperties),
            },
          ),
        ),
    },

    {
      name: 'add_category_property',
      descriptionKey: 'inventory.agentTools.add_category_property.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          categoryId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.add_category_property.params.categoryId',
          },
          name: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.add_category_property.params.name',
          },
          type: {
            type: 'string',
            enum: [...CATEGORY_PROPERTY_TYPES],
            descriptionKey:
              'inventory.agentTools.add_category_property.params.type',
          },
          unit: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.add_category_property.params.unit',
          },
          required: {
            type: 'boolean',
            descriptionKey:
              'inventory.agentTools.add_category_property.params.required',
          },
          options: {
            type: 'array',
            descriptionKey:
              'inventory.agentTools.add_category_property.params.options',
            items: {
              type: 'string',
              descriptionKey:
                'inventory.agentTools.add_category_property.params.optionItem',
            },
          },
        },
        required: ['categoryId', 'name', 'type'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.add_category_property',
        params: { name: String(args.name) },
      }),
      handler: async (args) => {
        const type = String(args.type);
        if (!isCategoryPropertyType(type)) {
          throw new Error(
            i18n.t('inventory.errors.invalidPropertyType', { type }),
          );
        }
        return withPropertyRef(
          await categoriesService.addProperty(
            toCategoryId(String(args.categoryId), i18n),
            {
              name: String(args.name),
              type,
              unit: args.unit === undefined ? undefined : String(args.unit),
              required:
                args.required === undefined
                  ? undefined
                  : Boolean(args.required),
              options: Array.isArray(args.options)
                ? args.options.map((option) => String(option))
                : undefined,
            },
          ),
        );
      },
    },

    {
      name: 'update_category_property',
      descriptionKey:
        'inventory.agentTools.update_category_property.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          propertyId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_category_property.params.propertyId',
          },
          name: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_category_property.params.name',
          },
          // Changing the type is offered here for the same reason it is offered
          // in the UI: a property first declared as text and then found to be a
          // number would otherwise be stuck, with no path but delete-and-lose.
          type: {
            type: 'string',
            enum: [...CATEGORY_PROPERTY_TYPES],
            descriptionKey:
              'inventory.agentTools.update_category_property.params.type',
          },
          order: {
            type: 'number',
            descriptionKey:
              'inventory.agentTools.update_category_property.params.order',
          },
          unit: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.update_category_property.params.unit',
          },
          required: {
            type: 'boolean',
            descriptionKey:
              'inventory.agentTools.update_category_property.params.required',
          },
          options: {
            type: 'array',
            descriptionKey:
              'inventory.agentTools.update_category_property.params.options',
            items: {
              type: 'string',
              descriptionKey:
                'inventory.agentTools.update_category_property.params.optionItem',
            },
          },
        },
        required: ['propertyId'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.update_category_property',
        params: { name: String(args.name ?? args.propertyId) },
      }),
      handler: async (args) => {
        let type: CategoryPropertyType | undefined;
        if (args.type !== undefined) {
          const raw = String(args.type);
          if (!isCategoryPropertyType(raw)) {
            throw new Error(
              i18n.t('inventory.errors.invalidPropertyType', { type: raw }),
            );
          }
          type = raw;
        }
        return withPropertyRef(
          await categoriesService.updateProperty(String(args.propertyId), {
            name: args.name === undefined ? undefined : String(args.name),
            type,
            order: args.order === undefined ? undefined : Number(args.order),
            unit: args.unit === undefined ? undefined : String(args.unit),
            required:
              args.required === undefined ? undefined : Boolean(args.required),
            options: Array.isArray(args.options)
              ? args.options.map((option) => String(option))
              : undefined,
          }),
        );
      },
    },

    // ── DESTRUCTIVE ───────────────────────────────────────────────────────────

    {
      name: 'delete_component',
      descriptionKey: 'inventory.agentTools.delete_component.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          componentId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.delete_component.params.componentId',
          },
        },
        required: ['componentId'],
      },
      confirmSummary: async (args) => {
        const comp = await inventoryService.findOne(
          componentIdOf(String(args.componentId)),
        );
        return {
          key: 'agentConfirm.delete_component',
          params: { name: comp?.name ?? String(args.componentId) },
        };
      },
      handler: async (args) =>
        inventoryService.delete(toComponentId(String(args.componentId), i18n)),
    },
    {
      name: 'delete_item_category',
      descriptionKey: 'inventory.agentTools.delete_item_category.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          categoryId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.delete_item_category.params.categoryId',
          },
        },
        required: ['categoryId'],
      },
      confirmSummary: async (args) => {
        const id = toCategoryId(String(args.categoryId), i18n);
        const categories = await categoriesService.list();
        const category = categories.find((entry) => entry.id === id);
        return {
          key: 'agentConfirm.delete_item_category',
          params: { name: category?.name ?? String(args.categoryId) },
        };
      },
      handler: async (args) => {
        await categoriesService.deleteCategory(
          toCategoryId(String(args.categoryId), i18n),
        );
        return { ok: true };
      },
    },

    {
      name: 'delete_category_property',
      descriptionKey:
        'inventory.agentTools.delete_category_property.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          propertyId: {
            type: 'string',
            descriptionKey:
              'inventory.agentTools.delete_category_property.params.propertyId',
          },
        },
        required: ['propertyId'],
      },
      // A destructive confirmation showing a uuid asks the person to approve
      // something they cannot recognise — resolve the name it deletes.
      confirmSummary: async (args) => {
        const propertyId = String(args.propertyId);
        const categories = await categoriesService.list();
        const property = categories
          .flatMap((category) => category.properties)
          .find((entry) => entry.id === propertyId);
        return {
          key: 'agentConfirm.delete_category_property',
          params: { name: property?.name ?? propertyId },
        };
      },
      handler: async (args) => {
        await categoriesService.deleteProperty(String(args.propertyId));
        return { ok: true };
      },
    },
  ]);
