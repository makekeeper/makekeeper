import { NotFoundException } from '@nestjs/common';
import {
  AttachmentStorageService,
  ExchangeSectionProvider,
  PluginI18nService,
  PrismaService,
  type ExchangeExportContext,
  type ExchangeImportContext,
  generateUuid,
  isExchangeRecord,
  isRecordObject,
  readNumber,
  readOptionalString,
  readString,
  exchangeScopeFilter,
  exchangeScopeStamp,
} from '@makekeeper/backend-core';
import {
  PICTURE_ATTACHMENT_WHERE,
  formatObjectRef,
  parseObjectRef,
  resolveEntityId,
} from '@makekeeper/plugin-contract';
import { CATEGORY_MAX_DEPTH } from '../categories';

// Exchange section providers of the inventory plugin (#62).
//
// `inventory.components` (project root): the BOM links plus embedded Component
// snapshots — placement is stripped (storages are not part of a project
// export). Import strategy is user-selectable: `create-new` mints fresh
// inventory items at quantity 0; `match-existing` links by SKU, then
// case-insensitive name, and only creates what it cannot match.
//
// `inventory.stock` (storage root): components physically placed in the
// exported subtree, with their cell placement and current quantity. Movement
// history does NOT travel — import writes one opening-balance ADJUSTMENT per
// component instead. Which storages form the subtree is learned from the refs
// `storages.structure` accumulated (dependsOn ordering), so this plugin never
// imports the storages plugin's code.

function componentRef(id: string): string | null {
  return formatObjectRef({
    pluginId: 'inventory',
    entityType: 'component',
    entityId: id,
  });
}

function mapId(
  ctx: {
    preserveIds: boolean;
    idMap: { translate(t: string, id: string | null): string | null };
  },
  entityType: string,
  oldId: string | null,
): string | null {
  if (!oldId) return null;
  return ctx.preserveIds ? oldId : ctx.idMap.translate(entityType, oldId);
}

// A property definition as it travels (#205). Keyed by NAME for the same reason
// the category is: an id names nothing in the instance the archive lands in.
interface PropertyDefinitionRecord {
  name: string;
  type: string;
  unit: string | null;
  required: boolean;
  options: string | null;
  order: number;
}

type ExportedProperty = PropertyDefinitionRecord & { id: string };

function propertyDefinition(
  property: ExportedProperty,
): PropertyDefinitionRecord {
  return {
    name: property.name,
    type: property.type,
    unit: property.unit,
    required: property.required,
    options: property.options,
    order: property.order,
  };
}

// A component with everything the category layer contributes to it: the
// category by name, the definitions its values need to be readable, and the
// values themselves.
interface ComponentWithCategory {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  // Exported by NAME, not by id (#205): a category id is meaningless in the
  // instance the archive lands in, while the name is what the person recognises.
  categoryRef: { name: string; properties: ExportedProperty[] } | null;
  propertyValues: Array<{
    valueText: string | null;
    valueNumber: number | null;
    property: ExportedProperty;
  }>;
  minQuantity: number;
  unit: string | null;
  links: string | null;
  customFields: string | null;
}

// The Prisma include that fills `ComponentWithCategory` — one shape, so export
// and snapshot cannot drift apart.
const COMPONENT_CATEGORY_INCLUDE = {
  categoryRef: { include: { properties: true } },
  propertyValues: { include: { property: true } },
} as const;

function componentSnapshot(
  component: ComponentWithCategory,
): Record<string, unknown> {
  // Definitions travel for the category's own set AND for anything this item
  // holds a value for — a value inherited from an ancestor would otherwise
  // arrive with nothing to explain what it is.
  const definitions = new Map<string, PropertyDefinitionRecord>();
  for (const property of component.categoryRef?.properties ?? []) {
    definitions.set(property.id, propertyDefinition(property));
  }
  for (const value of component.propertyValues) {
    definitions.set(value.property.id, propertyDefinition(value.property));
  }
  return {
    t: 'component',
    id: component.id,
    name: component.name,
    sku: component.sku,
    description: component.description,
    category: component.categoryRef?.name ?? null,
    categoryProperties: [...definitions.values()],
    propertyValues: component.propertyValues.map((value) => ({
      name: value.property.name,
      valueText: value.valueText,
      valueNumber: value.valueNumber,
    })),
    minQuantity: component.minQuantity,
    unit: component.unit,
    links: component.links,
    customFields: component.customFields,
  };
}

// Names collide case-insensitively, exactly as they do in the service.
const normalizePropertyName = (name: string): string =>
  name.trim().toLowerCase();

function readPropertyDefinitions(
  raw: Record<string, unknown>,
): PropertyDefinitionRecord[] {
  const list = raw['categoryProperties'];
  if (!Array.isArray(list)) return [];
  const out: PropertyDefinitionRecord[] = [];
  for (const entry of list) {
    if (!isRecordObject(entry)) continue;
    const name = readString(entry, 'name', 64);
    const type = readOptionalString(entry, 'type', 20);
    if (!name || !type) continue;
    out.push({
      name,
      type,
      unit: readOptionalString(entry, 'unit', 16),
      required: entry['required'] === true,
      options: readOptionalString(entry, 'options', 20_000),
      order: readNumber(entry, 'order') ?? 0,
    });
  }
  return out;
}

interface PropertyValueRecord {
  name: string;
  valueText: string | null;
  valueNumber: number | null;
}

function readPropertyValues(
  raw: Record<string, unknown>,
): PropertyValueRecord[] {
  const list = raw['propertyValues'];
  if (!Array.isArray(list)) return [];
  const out: PropertyValueRecord[] = [];
  for (const entry of list) {
    if (!isRecordObject(entry)) continue;
    const name = readString(entry, 'name', 64);
    if (!name) continue;
    out.push({
      name,
      valueText: readOptionalString(entry, 'valueText', 512),
      valueNumber: readNumber(entry, 'valueNumber'),
    });
  }
  return out;
}

// Legacy archives (pre-#71) carried a first-class `datasheetUrl`; the column is
// gone, so fold any such value into the generic `links` list on import instead
// of dropping it. Well-formed links without a legacy datasheet pass through
// untouched (the common case).
function foldLegacyDatasheet(
  links: string | null,
  datasheetUrl: string | null,
  label: string,
): string | null {
  if (!datasheetUrl) return links;
  const list: Array<{ label: string; url: string }> = [];
  if (links) {
    try {
      const parsed: unknown = JSON.parse(links);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!isRecordObject(entry)) continue;
          const url = readOptionalString(entry, 'url', 1000);
          if (url)
            list.push({
              label: readOptionalString(entry, 'label', 300) ?? '',
              url,
            });
        }
      }
    } catch {
      // Malformed links JSON in a legacy archive — keep the datasheet anyway.
    }
  }
  list.push({ label, url: datasheetUrl });
  return JSON.stringify(list);
}

interface ComponentImportBase {
  name: string;
  sku: string | null;
  description: string | null;
  minQuantity: number;
  unit: string | null;
  links: string | null;
  customFields: string | null;
}

function readComponentBase(
  raw: Record<string, unknown>,
  datasheetLabel: string,
): ComponentImportBase | null {
  const name = readString(raw, 'name', 300);
  if (!name) return null;
  return {
    name,
    sku: readOptionalString(raw, 'sku', 200),
    description: readOptionalString(raw, 'description', 10_000),
    minQuantity: readNumber(raw, 'minQuantity') ?? 0,
    unit: readOptionalString(raw, 'unit', 20) ?? 'pcs',
    links: foldLegacyDatasheet(
      readOptionalString(raw, 'links', 20_000),
      readOptionalString(raw, 'datasheetUrl', 1000),
      datasheetLabel,
    ),
    customFields: readOptionalString(raw, 'customFields', 20_000),
  };
}

// Every photograph of an item rides in the archive (#218) — deliberately wider
// than the project precedent, which exports the cover only. Losing a photograph
// is a bigger problem than a heavy archive: the pictures are how a part is
// identified again, and nothing else in the dump can reconstruct them.
//
// The record carries metadata only; the bytes go through `ctx.files`, and
// previews are regenerated on import (#113) — a derivative is a cache, not data.
async function exportComponentPhotos(
  ctx: ExchangeExportContext,
  prisma: PrismaService,
  attachments: AttachmentStorageService,
  componentId: string,
  coverAttachmentId: string | null,
): Promise<Record<string, unknown>[]> {
  const rows = await prisma.attachment.findMany({
    // The picture question in its shared query form (#122): the archive carries
    // an item's PHOTOGRAPHS, and a row the decoder rejected is not one. Without
    // this the export and the gallery would disagree about what an item has.
    where: { componentId, ...PICTURE_ATTACHMENT_WHERE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const out: Record<string, unknown>[] = [];
  for (const att of rows) {
    const file = await attachments.resolveExistingFile(att.id);
    // A row whose bytes are gone (a restored dump, the #120 sweep) is skipped
    // rather than exported as a promise the import cannot keep.
    if (!file) continue;
    await ctx.files.putFileFromPath(att.id, file.path);
    out.push({
      id: att.id,
      mimeType: att.mimeType,
      filename: att.filename,
      sizeBytes: att.sizeBytes,
      isCover: att.id === coverAttachmentId,
    });
  }
  return out;
}

// The other half: re-create the rows, re-stage the bytes, and re-point the
// cover. Order is `createdAt`, and the rows are written in archive order, so the
// set comes back the way it left; the pin is restored explicitly because a
// regenerated id cannot carry it.
async function importComponentPhotos(
  ctx: ExchangeImportContext,
  attachments: AttachmentStorageService,
  raw: Record<string, unknown>,
  componentId: string,
): Promise<void> {
  const list = raw['photos'];
  if (!Array.isArray(list)) return;
  let coverId: string | null = null;
  for (const entry of list) {
    if (!isRecordObject(entry)) continue;
    const oldId = readString(entry, 'id', 100);
    if (!oldId) continue;
    const src = await ctx.files.filePath(oldId);
    if (!src) continue;
    const mimeType = readString(entry, 'mimeType', 100) ?? 'image/jpeg';
    const filename = readOptionalString(entry, 'filename', 300);
    const newAttId = 'att_' + generateUuid();
    const imported = await attachments.importFileFromPath(
      newAttId,
      mimeType,
      filename,
      src,
    );
    await ctx.tx.attachment.create({
      data: {
        id: newAttId,
        ownerPluginId: 'inventory',
        componentId,
        storagePath: imported.relPath,
        mimeType,
        filename,
        sizeBytes: imported.sizeBytes,
        isImage: imported.isImage,
        ...imported.previews,
        ...exchangeScopeStamp(ctx),
      },
    });
    if (entry['isCover'] === true) coverId = newAttId;
  }
  if (coverId) {
    await ctx.tx.component.update({
      where: { id: componentId },
      data: { coverAttachmentId: coverId },
    });
  }
}

export function createInventoryExchangeProviders(
  prisma: PrismaService,
  i18n: PluginI18nService,
  attachments: AttachmentStorageService,
): ExchangeSectionProvider[] {
  // Label for datasheet URLs folded out of legacy archives into `links` (#71).
  const datasheetLabel = i18n.t('inventory.exchange.datasheetLinkLabel');
  // Archives name a category, they do not carry its id (#205). Match one that
  // already exists by name, and create a bare root category when none does —
  // the alternative is dropping the categorisation the archive recorded. The
  // created category has no properties: property definitions are the receiving
  // instance's to write, not an import's to invent.
  async function resolveCategoryId(
    ctx: Parameters<ExchangeSectionProvider['importSection']>[1],
    raw: Record<string, unknown>,
  ): Promise<string | null> {
    const name = readOptionalString(raw, 'category', 200)?.trim();
    if (!name) return null;
    const existing = await ctx.tx.itemCategory.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...exchangeScopeFilter(ctx),
      },
    });
    if (existing) return existing.id;
    const created = await ctx.tx.itemCategory.create({
      data: { id: generateUuid(), name, ...exchangeScopeStamp(ctx) },
    });
    return created.id;
  }

  // A property of this name already visible from `categoryId`, ancestors
  // included. The import must reuse it rather than mint a duplicate: the name
  // uniqueness the service enforces at write time is an invariant readers rely
  // on, and an archive is not exempt from it.
  async function chainPropertyId(
    ctx: Parameters<ExchangeSectionProvider['importSection']>[1],
    categoryId: string,
    name: string,
  ): Promise<string | null> {
    let currentId: string | null = categoryId;
    let depth = 0;
    const wanted = normalizePropertyName(name);
    while (currentId && depth < CATEGORY_MAX_DEPTH) {
      // Annotated, not inferred: the walk assigns `parentId` back into
      // `currentId`, and Prisma's inferred payload would make that circular.
      const category: {
        parentId: string | null;
        inheritProperties: boolean;
        properties: Array<{ id: string; name: string }>;
      } | null = await ctx.tx.itemCategory.findUnique({
        where: { id: currentId },
        include: { properties: true },
      });
      if (!category) return null;
      const match = category.properties.find(
        (property) => normalizePropertyName(property.name) === wanted,
      );
      if (match) return match.id;
      if (!category.inheritProperties || !category.parentId) return null;
      currentId = category.parentId;
      depth += 1;
    }
    return null;
  }

  // The property definitions and values an archived component carried (#205),
  // landed on the category it was matched to. Definitions missing from the
  // receiving instance are created on that category — the archive recorded a
  // typed set, and dropping it would leave the values unreadable.
  async function importCategoryData(
    ctx: Parameters<ExchangeSectionProvider['importSection']>[1],
    raw: Record<string, unknown>,
    componentId: string,
    categoryId: string | null,
  ): Promise<void> {
    if (!categoryId) return;
    const definitions = readPropertyDefinitions(raw);
    const values = readPropertyValues(raw);
    if (!definitions.length && !values.length) return;
    const declared = new Set(
      definitions.map((definition) => normalizePropertyName(definition.name)),
    );
    // A value whose definition did not travel (an older archive) still needs
    // something to hang on: infer the plainest definition that fits it.
    const inferred: PropertyDefinitionRecord[] = values
      .filter((value) => !declared.has(normalizePropertyName(value.name)))
      .map((value) => ({
        name: value.name,
        type: value.valueNumber !== null ? 'number' : 'text',
        unit: null,
        required: false,
        options: null,
        order: 0,
      }));

    const byName = new Map<string, string>();
    for (const definition of [...definitions, ...inferred]) {
      const key = normalizePropertyName(definition.name);
      if (byName.has(key)) continue;
      const existingId = await chainPropertyId(
        ctx,
        categoryId,
        definition.name,
      );
      if (existingId) {
        byName.set(key, existingId);
        continue;
      }
      const created = await ctx.tx.categoryProperty.create({
        data: {
          id: generateUuid(),
          categoryId,
          name: definition.name,
          type: definition.type,
          unit: definition.unit,
          required: definition.required,
          options: definition.options,
          order: definition.order,
        },
      });
      byName.set(key, created.id);
    }

    for (const value of values) {
      if (value.valueText === null && value.valueNumber === null) continue;
      const propertyId = byName.get(normalizePropertyName(value.name));
      if (!propertyId) continue;
      await ctx.tx.componentPropertyValue.create({
        data: {
          id: generateUuid(),
          componentId,
          propertyId,
          valueText: value.valueText,
          valueNumber: value.valueNumber,
        },
      });
    }
  }
  // Match an archived component to an existing inventory item: SKU first,
  // then case-insensitive name. Returns the matched id or null.
  async function matchExisting(
    ctx: Parameters<ExchangeSectionProvider['importSection']>[1],
    base: ComponentImportBase,
  ): Promise<string | null> {
    if (base.sku) {
      const bySku = await ctx.tx.component.findFirst({
        where: { sku: base.sku, ...exchangeScopeFilter(ctx) },
      });
      if (bySku) return bySku.id;
    }
    const byName = await ctx.tx.component.findFirst({
      where: {
        name: { equals: base.name, mode: 'insensitive' },
        ...exchangeScopeFilter(ctx),
      },
    });
    return byName?.id ?? null;
  }

  const componentsProvider: ExchangeSectionProvider = {
    sectionKey: 'inventory.components',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'projects',
            entityType: 'project',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      const links = await prisma.projectComponent.findMany({
        where: { projectId: resolved.id },
        include: { component: { include: COMPONENT_CATEGORY_INCLUDE } },
      });
      const records: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const link of links) {
        if (!seen.has(link.componentId)) {
          seen.add(link.componentId);
          const ref = componentRef(link.componentId);
          if (ref) ctx.addExportedRef(ref);
          records.push({
            ...componentSnapshot(link.component),
            photos: await exportComponentPhotos(
              ctx,
              prisma,
              attachments,
              link.componentId,
              link.component.coverAttachmentId,
            ),
          });
        }
        records.push({
          t: 'projectComponent',
          projectId: link.projectId,
          componentId: link.componentId,
          neededQty: link.neededQty,
        });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'component')).length,
      };
    },

    async importSection(records, ctx) {
      const matchStrategy = ctx.options['strategy'] === 'match-existing';
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'component')) continue;
        const oldId = readString(raw, 'id', 100);
        const base = readComponentBase(raw, datasheetLabel);
        if (!oldId || !base) continue;
        if (matchStrategy) {
          const existingId = await matchExisting(ctx, base);
          if (existingId) {
            ctx.idMap.set('component', oldId, existingId);
            continue;
          }
        }
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('component', oldId, newId);
        // BOM import carries no stock: new items start at quantity 0 with no
        // placement — stock arrives through orders or manual adjustments.
        const categoryId = await resolveCategoryId(ctx, raw);
        await ctx.tx.component.create({
          data: {
            id: newId,
            ...base,
            categoryId,
            quantity: 0,
            ...exchangeScopeStamp(ctx),
          },
        });
        await importCategoryData(ctx, raw, newId, categoryId);
        await importComponentPhotos(ctx, attachments, raw, newId);
        created += 1;
      }
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'projectComponent')) continue;
        const projectId = mapId(
          ctx,
          'project',
          readString(raw, 'projectId', 100),
        );
        const componentId = mapId(
          ctx,
          'component',
          readString(raw, 'componentId', 100),
        );
        if (!projectId || !componentId) continue;
        await ctx.tx.projectComponent.create({
          data: {
            id: generateUuid(),
            projectId,
            componentId,
            neededQty: readNumber(raw, 'neededQty') ?? 1,
            // Reservations never travel — there is no stock to reserve against.
            reservedQty: 0,
          },
        });
        created += 1;
      }
      return { created };
    },
  };

  const stockProvider: ExchangeSectionProvider = {
    sectionKey: 'inventory.stock',

    async exportSection(ctx) {
      // The storage subtree = the storage refs `storages.structure` exported
      // before us (dependsOn ordering) — parsed, never string-matched.
      const storageIds = new Set<string>();
      for (const ref of ctx.getExportedRefs()) {
        const parsed = parseObjectRef(ref);
        if (
          parsed &&
          parsed.pluginId === 'storages' &&
          parsed.entityType === 'storage'
        ) {
          storageIds.add(parsed.entityId);
        }
      }
      const components = await prisma.component.findMany({
        where: { storageId: { in: [...storageIds] } },
        include: COMPONENT_CATEGORY_INCLUDE,
      });
      const records: Record<string, unknown>[] = [];
      for (const component of components) {
        const ref = componentRef(component.id);
        if (ref) ctx.addExportedRef(ref);
        records.push({
          ...componentSnapshot(component),
          photos: await exportComponentPhotos(
            ctx,
            prisma,
            attachments,
            component.id,
            component.coverAttachmentId,
          ),
          t: 'stockComponent',
          quantity: component.quantity,
          storageId: component.storageId,
          storageRow: component.storageRow,
          storageCol: component.storageCol,
        });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'stockComponent'))
          .length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'stockComponent')) continue;
        const oldId = readString(raw, 'id', 100);
        const base = readComponentBase(raw, datasheetLabel);
        if (!oldId || !base) continue;
        const storageId = mapId(
          ctx,
          'storage',
          readOptionalString(raw, 'storageId', 100),
        );
        const quantity = readNumber(raw, 'quantity') ?? 0;
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('component', oldId, newId);
        const categoryId = await resolveCategoryId(ctx, raw);
        await ctx.tx.component.create({
          data: {
            id: newId,
            ...base,
            categoryId,
            quantity,
            storageId,
            storageRow: storageId ? readNumber(raw, 'storageRow') : null,
            storageCol: storageId ? readNumber(raw, 'storageCol') : null,
            ...exchangeScopeStamp(ctx),
          },
        });
        await importCategoryData(ctx, raw, newId, categoryId);
        await importComponentPhotos(ctx, attachments, raw, newId);
        created += 1;
        // History does not travel — record the imported quantity as an
        // opening balance so the ledger explains the stock level.
        if (quantity !== 0) {
          await ctx.tx.stockMovement.create({
            data: {
              id: generateUuid(),
              componentId: newId,
              delta: quantity,
              type: 'ADJUSTMENT',
              note: i18n.t('inventory.exchange.openingBalance', {}, ctx.locale),
              ...exchangeScopeStamp(ctx),
            },
          });
        }
      }
      return { created };
    },
  };

  return [componentsProvider, stockProvider];
}
