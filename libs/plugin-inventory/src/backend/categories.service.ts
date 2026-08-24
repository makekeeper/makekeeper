import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  generateUuid,
} from '@makekeeper/backend-core';
import type { CategoryProperty, ItemCategory } from '@prisma/client';
import {
  CATEGORY_MAX_DEPTH,
  coercePropertyValue,
  isCategoryPropertyType,
  normalizeName,
  type CategoryPropertyDto,
  type CategoryPropertyType,
  type ComponentPropertyValueDto,
  type EffectiveProperty,
  type ItemCategoryDto,
  type PropertyValueInput,
} from '../categories';

// The slice of the client the spill path touches. Named so the same helper can
// run on the shared client and inside an interactive transaction — a spill that
// commits without the delete it was protecting would be worse than no spill.
type SpillClient = Pick<PrismaService, 'component' | 'componentPropertyValue'>;

// How many previously-seen values a tag-source property offers as suggestions.
// A list longer than this stops being a shortcut and becomes a search problem.
const SUGGESTION_LIMIT = 50;

// What joins the segments of a category path. Structure, not prose: it is the
// same in every locale, which is why it is here and not in a locale file.
const PATH_SEPARATOR = ' / ';

// A `{ key, value }` pair as `Component.customFields` stores them.
interface CustomFieldPair {
  key: string;
  value: string;
}

// Names collide case-insensitively — a chain carrying both "Package" and
// "package" is a mistake being made, not a distinction being drawn — and that
// comparison is `normalizeName`, imported rather than restated: the value
// coercion applies exactly the same rule, and two spellings of
// "case-insensitive" is how a value the picker offers gets rejected on save.

// The label a spilled value keeps once its definition is gone. The unit rides
// along in the key because it is the only place left to put it — without it,
// "Length = 10" loses the fact that it was millimetres.
const spillKey = (name: string, unit: string | null): string =>
  unit ? `${name}, ${unit}` : name;

const parseOptions = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
};

const parseCustomFields = (raw: string | null): CustomFieldPair[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null,
      )
      .map((entry) => ({
        key: String(entry.key ?? ''),
        value: String(entry.value ?? ''),
      }))
      .filter((pair) => pair.key.trim() !== '');
  } catch {
    return [];
  }
};

const toPropertyDto = (property: CategoryProperty): CategoryPropertyDto => ({
  id: property.id,
  categoryId: property.categoryId,
  name: property.name,
  // The column is a plain string; anything the type union does not know about
  // would make every consumer branch on an impossible case, so it reads as text.
  type: isCategoryPropertyType(property.type) ? property.type : 'text',
  unit: property.unit,
  required: property.required,
  options: parseOptions(property.options),
  order: property.order,
});

type CategoryWithProperties = ItemCategory & { properties: CategoryProperty[] };

// The category tree and the property sets it owns (#205).
//
// The tree is loaded whole for every chain walk. That is deliberate: categories
// are a hand-curated vocabulary numbering in the tens, and one query beats a
// recursive CTE nobody can read — and beats N queries up the chain.
@Injectable()
export class InventoryCategoriesService {
  private readonly logger = new Logger(InventoryCategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
  ) {}

  private async loadAll(): Promise<CategoryWithProperties[]> {
    return this.prisma.itemCategory.findMany({
      include: { properties: { orderBy: { order: 'asc' } } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  // The chain a category's items actually carry: itself, then upwards for as
  // long as each step opts into inheriting. The flag sits on the CHILD — it is
  // the child that decides whether its ancestors apply to it.
  private chainOf(
    categoryId: string,
    byId: Map<string, CategoryWithProperties>,
  ): CategoryWithProperties[] {
    const chain: CategoryWithProperties[] = [];
    let current = byId.get(categoryId);
    let depth = 0;
    while (current && depth < CATEGORY_MAX_DEPTH) {
      chain.push(current);
      if (!current.inheritProperties || !current.parentId) break;
      current = byId.get(current.parentId);
      depth += 1;
    }
    return chain;
  }

  // Every category whose chain passes through `categoryId` — the ones a new
  // property name here would also land on. A child that opted out of inheriting
  // cuts its whole subtree off, so the walk stops there.
  private inheritingDescendants(
    categoryId: string,
    all: CategoryWithProperties[],
  ): CategoryWithProperties[] {
    const childrenOf = new Map<string, CategoryWithProperties[]>();
    for (const category of all) {
      if (!category.parentId) continue;
      const siblings = childrenOf.get(category.parentId) ?? [];
      siblings.push(category);
      childrenOf.set(category.parentId, siblings);
    }
    const found: CategoryWithProperties[] = [];
    const queue = [categoryId];
    while (queue.length) {
      const currentId = queue.shift();
      if (currentId === undefined) break;
      for (const child of childrenOf.get(currentId) ?? []) {
        if (!child.inheritProperties) continue;
        found.push(child);
        queue.push(child.id);
      }
    }
    return found;
  }

  // Refuse a name already taken anywhere along the chains this property would
  // reach — upwards through the ancestors it inherits from, downwards through
  // the descendants that inherit from it. Deciding this at write time is what
  // lets every reader treat the effective set as a flat list.
  private assertNameFree(
    categoryId: string,
    name: string,
    all: CategoryWithProperties[],
    ignorePropertyId?: string,
  ): void {
    const byId = new Map(all.map((category) => [category.id, category]));
    const reach = [
      ...this.chainOf(categoryId, byId),
      ...this.inheritingDescendants(categoryId, all),
    ];
    const wanted = normalizeName(name);
    for (const category of reach) {
      for (const property of category.properties) {
        if (property.id === ignorePropertyId) continue;
        if (normalizeName(property.name) === wanted) {
          // A rejected name is the caller's mistake, not the server's: 400, so
          // the message survives to the toast that shows the collision rule.
          throw new BadRequestException(
            this.i18n.t('inventory.errors.propertyNameTaken', {
              name: property.name,
              category: category.name,
            }),
          );
        }
      }
    }
  }

  async list(): Promise<ItemCategoryDto[]> {
    const all = await this.loadAll();
    return all.map((category) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      inheritProperties: category.inheritProperties,
      order: category.order,
      properties: category.properties.map(toPropertyDto),
    }));
  }

  // Every category as `id -> full path`. The tree walk and its depth cap belong
  // to the service that owns the tree; a caller that needs to name a category
  // unambiguously — the recognition prompt, where a leaf called "Resistors"
  // exists under two branches (#206) — asks for the paths rather than walking
  // the parents itself.
  async paths(): Promise<Map<string, string>> {
    const all = await this.loadAll();
    const byId = new Map(all.map((category) => [category.id, category]));
    return new Map(
      all.map((category) => {
        const segments: string[] = [];
        let current: CategoryWithProperties | undefined = category;
        let depth = 0;
        // The same cap the chain walk uses: a cycle the tree should never
        // contain must not hang the caller.
        while (current && depth < CATEGORY_MAX_DEPTH) {
          segments.unshift(current.name);
          current = current.parentId ? byId.get(current.parentId) : undefined;
          depth += 1;
        }
        return [category.id, segments.join(PATH_SEPARATOR)] as const;
      }),
    );
  }

  async effectiveProperties(
    categoryId: string | null,
  ): Promise<EffectiveProperty[]> {
    if (!categoryId) return [];
    const all = await this.loadAll();
    const byId = new Map(all.map((category) => [category.id, category]));
    if (!byId.has(categoryId)) return [];
    const chain = this.chainOf(categoryId, byId);
    return chain.flatMap((category, depth) =>
      category.properties.map((property) => ({
        ...toPropertyDto(property),
        inherited: depth > 0,
        ownerCategoryName: category.name,
      })),
    );
  }

  // The effective set for an item, resolved through its category.
  async effectivePropertiesFor(
    componentId: string,
  ): Promise<EffectiveProperty[]> {
    const component = await this.prisma.component.findUnique({
      where: { id: componentId },
      select: { categoryId: true },
    });
    return this.effectiveProperties(component?.categoryId ?? null);
  }

  async createCategory(input: {
    name: string;
    parentId?: string | null;
    inheritProperties?: boolean;
  }): Promise<ItemCategoryDto> {
    if (input.parentId) await this.requireCategory(input.parentId);
    // New nodes land at the end of their sibling list, like a new property does
    // — otherwise every category is order 0 and dragging cannot mean anything.
    const last = await this.prisma.itemCategory.findFirst({
      where: { parentId: input.parentId ?? null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const created = await this.prisma.itemCategory.create({
      data: {
        id: generateUuid(),
        name: input.name.trim(),
        parentId: input.parentId ?? null,
        inheritProperties: input.inheritProperties ?? true,
        order: (last?.order ?? -1) + 1,
      },
      include: { properties: true },
    });
    return {
      id: created.id,
      name: created.name,
      parentId: created.parentId,
      inheritProperties: created.inheritProperties,
      order: created.order,
      properties: [],
    };
  }

  async updateCategory(
    id: string,
    input: {
      name?: string;
      parentId?: string | null;
      inheritProperties?: boolean;
    },
  ): Promise<ItemCategoryDto> {
    await this.requireCategory(id);
    const all = await this.loadAll();

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === id) {
        throw new BadRequestException(
          this.i18n.t('inventory.errors.categoryCycle'),
        );
      }
      // Re-parenting under one's own descendant would orphan the subtree from
      // the root and make every chain walk spin until the depth cap.
      const descendantIds = new Set(
        this.collectDescendants(id, all).map((category) => category.id),
      );
      if (descendantIds.has(input.parentId)) {
        throw new BadRequestException(
          this.i18n.t('inventory.errors.categoryCycle'),
        );
      }
      await this.requireCategory(input.parentId);
    }

    // A move (or switching inheritance back on) exposes this category to a new
    // set of ancestors — the same collision that is refused when a property is
    // created must be refused here too, or the move would smuggle it in.
    const movesChain =
      input.parentId !== undefined || input.inheritProperties !== undefined;
    if (movesChain) {
      const rehearsed = all.map((category) =>
        category.id === id
          ? {
              ...category,
              parentId:
                input.parentId !== undefined
                  ? input.parentId
                  : category.parentId,
              inheritProperties:
                input.inheritProperties ?? category.inheritProperties,
            }
          : category,
      );
      const byId = new Map(
        rehearsed.map((category) => [category.id, category]),
      );
      const seen = new Map<string, string>();
      for (const category of [
        ...this.chainOf(id, byId),
        ...this.inheritingDescendants(id, rehearsed),
      ]) {
        for (const property of category.properties) {
          const key = normalizeName(property.name);
          const owner = seen.get(key);
          if (owner && owner !== category.id) {
            throw new BadRequestException(
              this.i18n.t('inventory.errors.propertyNameTaken', {
                name: property.name,
                category: category.name,
              }),
            );
          }
          seen.set(key, category.id);
        }
      }
    }

    const updated = await this.prisma.itemCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.inheritProperties !== undefined
          ? { inheritProperties: input.inheritProperties }
          : {}),
      },
      include: { properties: { orderBy: { order: 'asc' } } },
    });

    // A moved category — or one that just stopped inheriting — drops ancestor
    // properties from its own chain and from every chain below it. The values
    // items already hold for those properties would become unreachable, which
    // is the same silent loss the delete paths refuse: spill them (#205).
    if (movesChain) {
      const after = await this.loadAll();
      await this.spillOrphanedValues([
        id,
        ...this.inheritingDescendants(id, after).map((entry) => entry.id),
      ]);
    }

    return {
      id: updated.id,
      name: updated.name,
      parentId: updated.parentId,
      inheritProperties: updated.inheritProperties,
      order: updated.order,
      properties: updated.properties.map(toPropertyDto),
    };
  }

  // A drop in the tree: `orderedIds` is the final sibling order under
  // `parentId`. When the dragged node came from another parent, the move runs
  // through `updateCategory` first — that is where the cycle check, the
  // name-collision rehearsal and the spill already live, and a drag must not
  // get a laxer version of them than the parent picker.
  async reorderCategories(input: {
    parentId?: string | null;
    orderedIds: string[];
    movedId?: string;
  }): Promise<void> {
    const parentId = input.parentId ?? null;
    if (parentId) await this.requireCategory(parentId);
    if (input.movedId) {
      const moved = await this.requireCategory(input.movedId);
      if (moved.parentId !== parentId) {
        await this.updateCategory(input.movedId, { parentId });
      }
    }
    // Only rows that actually sit under this parent take an index — an id from
    // elsewhere in the payload is ignored rather than silently re-parented.
    const siblings = await this.prisma.itemCategory.findMany({
      where: { parentId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((sibling) => sibling.id));
    const ordered = input.orderedIds.filter((id) => siblingIds.has(id));
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ordered.entries()) {
        await tx.itemCategory.update({ where: { id }, data: { order: index } });
      }
    });
  }

  // The final order of a category's own properties after a drag. Inherited
  // properties are not in play: they render under their owner's order.
  async reorderProperties(
    categoryId: string,
    orderedIds: string[],
  ): Promise<void> {
    await this.requireCategory(categoryId);
    const owned = await this.prisma.categoryProperty.findMany({
      where: { categoryId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((property) => property.id));
    const ordered = orderedIds.filter((id) => ownedIds.has(id));
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ordered.entries()) {
        await tx.categoryProperty.update({
          where: { id },
          data: { order: index },
        });
      }
    });
  }

  private collectDescendants(
    categoryId: string,
    all: CategoryWithProperties[],
  ): CategoryWithProperties[] {
    const found: CategoryWithProperties[] = [];
    const queue = [categoryId];
    let guard = 0;
    while (queue.length && guard < all.length + 1) {
      const currentId = queue.shift();
      guard += 1;
      for (const category of all) {
        if (category.parentId !== currentId) continue;
        found.push(category);
        queue.push(category.id);
      }
    }
    return found;
  }

  // Deleting a category unfiles its items rather than deleting them, and their
  // values spill into the free-form pairs. Children are re-parented to this
  // category's parent — the schema's SET NULL would otherwise silently promote
  // a whole subtree to the root.
  async deleteCategory(id: string): Promise<void> {
    await this.requireCategory(id);
    const all = await this.loadAll();
    const category = all.find((entry) => entry.id === id);
    const propertyIds = (category?.properties ?? []).map(
      (property) => property.id,
    );
    const components = await this.prisma.component.findMany({
      where: { categoryId: id },
      select: { id: true },
    });
    // Items of DESCENDANT categories that inherited these properties hold
    // values too, and the FK cascade would take them with the property rows.
    // They are the easiest values in the system to lose, because nothing on
    // this screen mentions them — so they are spilled explicitly.
    const inheritors = propertyIds.length
      ? await this.prisma.componentPropertyValue.findMany({
          where: { propertyId: { in: propertyIds } },
          select: { componentId: true },
          distinct: ['componentId'],
        })
      : [];

    // One transaction: a spill that commits without its delete would duplicate
    // every value into the free-form pairs, and a delete without its spill is
    // exactly the loss the rule exists to prevent.
    await this.prisma.$transaction(async (tx) => {
      for (const component of components) {
        await this.spillValues(component.id, undefined, tx);
      }
      for (const holder of inheritors) {
        await this.spillValues(holder.componentId, propertyIds, tx);
      }
      await tx.itemCategory.updateMany({
        where: { parentId: id },
        data: { parentId: category?.parentId ?? null },
      });
      await tx.component.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      });
      // The now-empty property rows go with the category by FK cascade.
      await tx.itemCategory.delete({ where: { id } });
    });
    this.logger.log(
      `Deleted category ${id} (${components.length} items unfiled)`,
    );
  }

  // Spill whatever the given categories' items hold but their chains no longer
  // define. Used after a re-parent or an inheritance switch, where the loss is
  // caused by the chain changing rather than by anything being deleted.
  private async spillOrphanedValues(categoryIds: string[]): Promise<void> {
    if (!categoryIds.length) return;
    const components = await this.prisma.component.findMany({
      where: { categoryId: { in: categoryIds } },
      select: { id: true, categoryId: true },
    });
    for (const component of components) {
      await this.spillForCategoryChange(component.id, component.categoryId);
    }
  }

  async addProperty(
    categoryId: string,
    input: {
      name: string;
      type: CategoryPropertyType;
      unit?: string | null;
      required?: boolean;
      options?: string[];
    },
  ): Promise<CategoryPropertyDto> {
    await this.requireCategory(categoryId);
    const all = await this.loadAll();
    this.assertNameFree(categoryId, input.name, all);
    const last = await this.prisma.categoryProperty.findFirst({
      where: { categoryId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const created = await this.prisma.categoryProperty.create({
      data: {
        id: generateUuid(),
        categoryId,
        name: input.name.trim(),
        type: input.type,
        ...this.normalizeShape(input),
        order: (last?.order ?? -1) + 1,
      },
    });
    return toPropertyDto(created);
  }

  async updateProperty(
    id: string,
    input: {
      name?: string;
      type?: CategoryPropertyType;
      unit?: string | null;
      required?: boolean;
      options?: string[];
      order?: number;
    },
  ): Promise<CategoryPropertyDto> {
    const existing = await this.prisma.categoryProperty.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.propertyNotFound'),
      );
    }
    if (input.name !== undefined) {
      const all = await this.loadAll();
      this.assertNameFree(existing.categoryId, input.name, all, id);
    }
    const type = input.type ?? toPropertyDto(existing).type;
    // Changing the type retires the values stored under the old one — a text
    // value is not readable as a number and vice versa — so they spill first.
    if (type !== toPropertyDto(existing).type) {
      const holders = await this.prisma.componentPropertyValue.findMany({
        where: { propertyId: id },
        select: { componentId: true },
        distinct: ['componentId'],
      });
      for (const holder of holders) {
        await this.spillValues(holder.componentId, [id]);
      }
    }
    const updated = await this.prisma.categoryProperty.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...this.normalizeShape({
          type,
          unit: input.unit !== undefined ? input.unit : existing.unit,
          required: input.required,
          options:
            input.options !== undefined
              ? input.options
              : parseOptions(existing.options),
        }),
      },
    });
    return toPropertyDto(updated);
  }

  // The shape rules a property must obey whatever the caller sent: a unit and a
  // number are the only pair that means anything, options belong to `select`
  // alone. Enforced here rather than in the DTO so the agent tools cannot
  // route around it.
  private normalizeShape(input: {
    type: CategoryPropertyType;
    unit?: string | null;
    required?: boolean;
    options?: string[];
  }): {
    unit: string | null;
    required?: boolean;
    options: string | null;
  } {
    const options = (input.options ?? [])
      .map((option) => option.trim())
      .filter((option) => option !== '');
    return {
      unit: input.type === 'number' ? input.unit?.trim() || null : null,
      ...(input.required !== undefined ? { required: input.required } : {}),
      options:
        input.type === 'select' && options.length
          ? JSON.stringify(options)
          : null,
    };
  }

  async deleteProperty(id: string): Promise<void> {
    const property = await this.prisma.categoryProperty.findUnique({
      where: { id },
    });
    if (!property) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.propertyNotFound'),
      );
    }
    const values = await this.prisma.componentPropertyValue.findMany({
      where: { propertyId: id },
      select: { componentId: true },
      distinct: ['componentId'],
    });
    await this.prisma.$transaction(async (tx) => {
      for (const value of values) {
        await this.spillValues(value.componentId, [id], tx);
      }
      await tx.categoryProperty.delete({ where: { id } });
    });
  }

  // One property, with the category that owns it — enough to name it in a
  // breadcrumb. Feeds the `category-property` ORef resolver, so a ref another
  // plugin stored still reads as something human when it is shown back.
  async findProperty(
    id: string,
  ): Promise<{ id: string; name: string; categoryName: string } | null> {
    const property = await this.prisma.categoryProperty.findUnique({
      where: { id },
      include: { category: true },
    });
    return property
      ? {
          id: property.id,
          name: property.name,
          categoryName: property.category.name,
        }
      : null;
  }

  // Values people already typed for this property, offered while typing the
  // next one (#205). Picking an existing spelling beats retyping it — that is
  // true of any repeated field, which is why this is not conditional on
  // anything a different plugin happens to do with the value.
  async suggestValues(propertyId: string): Promise<string[]> {
    const rows = await this.prisma.componentPropertyValue.findMany({
      where: { propertyId, NOT: { valueText: null } },
      select: { valueText: true },
      distinct: ['valueText'],
      orderBy: { valueText: 'asc' },
      take: SUGGESTION_LIMIT,
    });
    return rows
      .map((row) => (row.valueText ?? '').trim())
      .filter((value) => value !== '');
  }

  // What an item actually ended up holding, as plain text, for the values
  // announcement (#205). Inheritance along the category chain is already
  // resolved by `valuesFor`, which is the part only this plugin can do — what
  // any of it MEANS is somebody else's question.
  async filledValuesFor(
    componentId: string,
  ): Promise<Array<{ propertyId: string; value: string }>> {
    const values = await this.valuesFor(componentId);
    return values
      .map((entry) => ({
        propertyId: entry.propertyId,
        value: entry.value === null ? '' : String(entry.value).trim(),
      }))
      .filter((entry) => entry.value !== '');
  }

  private async requireCategory(id: string): Promise<ItemCategory> {
    const category = await this.prisma.itemCategory.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.categoryNotFound'),
      );
    }
    return category;
  }

  // ── Item values ───────────────────────────────────────────────────────────

  async valuesFor(componentId: string): Promise<ComponentPropertyValueDto[]> {
    const component = await this.prisma.component.findUnique({
      where: { id: componentId },
      select: { categoryId: true },
    });
    if (!component?.categoryId) return [];
    const properties = await this.effectiveProperties(component.categoryId);
    const stored = await this.prisma.componentPropertyValue.findMany({
      where: { componentId },
    });
    const byProperty = new Map(
      stored.map((value) => [value.propertyId, value]),
    );
    return properties.map((property) => {
      const value = byProperty.get(property.id);
      return {
        propertyId: property.id,
        name: property.name,
        type: property.type,
        unit: property.unit,
        value:
          property.type === 'number'
            ? (value?.valueNumber ?? null)
            : (value?.valueText ?? null),
      };
    });
  }

  // Write the values a caller sent, ignoring anything that is not a property of
  // this item's category and anything that does not fit its declared shape. A
  // value that fails to fit is dropped rather than coerced: a silent "0" where
  // the model hallucinated a word is worse than a blank field.
  async setValues(
    componentId: string,
    input: PropertyValueInput,
  ): Promise<void> {
    const component = await this.prisma.component.findUnique({
      where: { id: componentId },
      select: { categoryId: true },
    });
    if (!component?.categoryId) return;
    const properties = await this.effectiveProperties(component.categoryId);
    const byId = new Map(properties.map((property) => [property.id, property]));

    for (const [propertyId, raw] of Object.entries(input)) {
      const property = byId.get(propertyId);
      if (!property) continue;
      const parsed = coercePropertyValue(property, raw);
      if (parsed === undefined) continue;
      if (parsed === null) {
        await this.prisma.componentPropertyValue.deleteMany({
          where: { componentId, propertyId },
        });
        continue;
      }
      const existing = await this.prisma.componentPropertyValue.findFirst({
        where: { componentId, propertyId },
        select: { id: true },
      });
      const data =
        property.type === 'number'
          ? { valueNumber: Number(parsed), valueText: null }
          : { valueText: String(parsed), valueNumber: null };
      // No upsert: the scope policy fails loud on upserts against scoped models,
      // because it cannot prove the parent of a row it may or may not create.
      if (existing) {
        await this.prisma.componentPropertyValue.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await this.prisma.componentPropertyValue.create({
          data: { id: generateUuid(), componentId, propertyId, ...data },
        });
      }
    }
  }

  // The one data-loss rule (#205): a value whose definition no longer applies
  // moves into `customFields` as `name = value`. Used by all three paths — the
  // item's category changed, the property was deleted, the category was deleted
  // — so none of them can drift into deleting quietly.
  //
  // `propertyIds` undefined means "every value this item has". `client` lets a
  // caller run the spill inside its own transaction, so it commits with the
  // delete it protects or not at all.
  async spillValues(
    componentId: string,
    propertyIds: string[] | undefined,
    client: SpillClient = this.prisma,
  ): Promise<void> {
    const values = await client.componentPropertyValue.findMany({
      where: {
        componentId,
        ...(propertyIds ? { propertyId: { in: propertyIds } } : {}),
      },
      include: { property: true },
    });
    if (!values.length) return;

    const component = await client.component.findUnique({
      where: { id: componentId },
      select: { customFields: true },
    });
    const pairs = parseCustomFields(component?.customFields ?? null);
    const taken = new Set(pairs.map((pair) => normalizeName(pair.key)));

    for (const value of values) {
      const text =
        value.valueText ??
        (value.valueNumber !== null ? String(value.valueNumber) : '');
      if (text.trim() === '') continue;
      let key = spillKey(value.property.name, value.property.unit);
      // A free-form pair of the same name already exists: keep both rather than
      // overwrite, because we cannot know which one the person meant to keep.
      if (taken.has(normalizeName(key))) {
        let suffix = 2;
        while (taken.has(normalizeName(`${key} (${suffix})`))) suffix += 1;
        key = `${key} (${suffix})`;
      }
      taken.add(normalizeName(key));
      pairs.push({ key, value: text });
    }

    await client.component.update({
      where: { id: componentId },
      data: { customFields: pairs.length ? JSON.stringify(pairs) : '' },
    });
    await client.componentPropertyValue.deleteMany({
      where: {
        componentId,
        ...(propertyIds ? { propertyId: { in: propertyIds } } : {}),
      },
    });
  }

  // Called when an item is about to change category: everything the new
  // category does not define spills, the rest stays put.
  async spillForCategoryChange(
    componentId: string,
    nextCategoryId: string | null,
  ): Promise<void> {
    const keep = new Set(
      (await this.effectiveProperties(nextCategoryId)).map(
        (property) => property.id,
      ),
    );
    const values = await this.prisma.componentPropertyValue.findMany({
      where: { componentId },
      select: { propertyId: true },
    });
    const doomed = values
      .map((value) => value.propertyId)
      .filter((propertyId) => !keep.has(propertyId));
    if (doomed.length) await this.spillValues(componentId, doomed);
  }
}
