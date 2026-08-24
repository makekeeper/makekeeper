import { InventoryCategoriesService } from './categories.service';

// The three rules this ticket lives or dies by (#205):
//   1. the effective property set walks the chain while inheritance holds,
//   2. a name already taken along that chain is refused at write time,
//   3. a value that loses its definition spills into the free-form pairs.
//
// The Prisma stub is hand-rolled rather than mocked wholesale: these tests are
// about which rows the service asks for and which it writes, and a fake that
// answers honestly reads better than a pile of `mockResolvedValueOnce`.

interface FakeCategory {
  id: string;
  name: string;
  parentId: string | null;
  inheritProperties: boolean;
  order: number;
  properties: FakeProperty[];
}

interface FakeProperty {
  id: string;
  categoryId: string;
  name: string;
  type: string;
  unit: string | null;
  required: boolean;
  options: string | null;
  order: number;
}

interface FakeValue {
  id: string;
  componentId: string;
  propertyId: string;
  valueText: string | null;
  valueNumber: number | null;
}

const property = (
  id: string,
  categoryId: string,
  name: string,
  overrides: Partial<FakeProperty> = {},
): FakeProperty => ({
  id,
  categoryId,
  name,
  type: 'text',
  unit: null,
  required: false,
  options: null,
  order: 0,
  ...overrides,
});

const category = (
  id: string,
  name: string,
  parentId: string | null,
  properties: FakeProperty[],
  inheritProperties = true,
): FakeCategory => ({
  id,
  name,
  parentId,
  inheritProperties,
  order: 0,
  properties,
});

function build(options: {
  categories: FakeCategory[];
  values?: FakeValue[];
  component?: { id: string; categoryId: string | null; customFields: string };
  // Items in the tree, for the delete paths — which components a category (or
  // one of its descendants) actually holds is the whole question there.
  components?: Array<{ id: string; categoryId: string | null }>;
}) {
  const categories = options.categories;
  const values = options.values ?? [];
  const component = options.component ?? {
    id: 'c1',
    categoryId: categories[0]?.id ?? null,
    customFields: '',
  };
  const components = options.components ?? [];

  const prisma = {
    itemCategory: {
      // `where.parentId` is the sibling-list read the reorder path does; the
      // whole-tree loads pass no `where` at all.
      findMany: ({ where }: { where?: { parentId?: string | null } } = {}) =>
        Promise.resolve(
          where && 'parentId' in where
            ? categories.filter((c) => c.parentId === (where.parentId ?? null))
            : categories,
        ),
      // Only ever asked for the highest-ordered sibling (order desc).
      findFirst: ({ where }: { where: { parentId: string | null } }) => {
        const siblings = categories.filter(
          (c) => c.parentId === where.parentId,
        );
        if (!siblings.length) return Promise.resolve(null);
        return Promise.resolve(
          siblings.reduce((a, b) => (a.order >= b.order ? a : b)),
        );
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(categories.find((c) => c.id === where.id) ?? null),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ order: 0, ...data, properties: [] }),
      ),
      // Writes back into the fake store: the spill that follows a re-parent or
      // an inheritance switch re-reads the tree, and a stub that forgot the
      // change would report nothing to spill.
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeCategory>;
      }) => {
        const found = categories.find((c) => c.id === where.id);
        if (found) Object.assign(found, data);
        return Promise.resolve({ ...found, ...data });
      },
      updateMany: () => Promise.resolve({ count: 0 }),
      delete: () => Promise.resolve({}),
    },
    categoryProperty: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          categories
            .flatMap((c) => c.properties)
            .find((p) => p.id === where.id) ?? null,
        ),
      findMany: ({ where }: { where?: { categoryId?: string } } = {}) =>
        Promise.resolve(
          categories
            .flatMap((c) => c.properties)
            .filter((p) =>
              where?.categoryId ? p.categoryId === where.categoryId : true,
            ),
        ),
      findFirst: () => Promise.resolve(null),
      create: ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...property('new', 'x', 'new'), ...data }),
      // Writes back so a reorder's `order = index` sweep is observable.
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeProperty>;
      }) => {
        const found = categories
          .flatMap((c) => c.properties)
          .find((p) => p.id === where.id);
        if (found) Object.assign(found, data);
        return Promise.resolve({
          ...property('p', 'x', 'p'),
          ...found,
          ...data,
        });
      },
      delete: jest.fn(() => Promise.resolve({})),
    },
    componentPropertyValue: {
      findMany: ({
        where,
      }: {
        where: { propertyId?: string | { in: string[] } };
      }) =>
        Promise.resolve(
          values
            .filter((v) => {
              const filter = where.propertyId;
              if (filter === undefined) return true;
              return typeof filter === 'string'
                ? v.propertyId === filter
                : filter.in.includes(v.propertyId);
            })
            .map((v) => ({
              ...v,
              property: categories
                .flatMap((c) => c.properties)
                .find((p) => p.id === v.propertyId),
            })),
        ),
      findFirst: () => Promise.resolve(null),
      create: jest.fn((_args: { data: { valueText: string | null } }) =>
        Promise.resolve({}),
      ),
      update: jest.fn(() => Promise.resolve({})),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    component: {
      findUnique: () => Promise.resolve(component),
      findMany: ({
        where,
      }: {
        where?: { categoryId?: string | { in: string[] } };
      } = {}) =>
        Promise.resolve(
          components.filter((entry) => {
            const filter = where?.categoryId;
            if (filter === undefined) return true;
            return typeof filter === 'string'
              ? entry.categoryId === filter
              : filter.in.includes(entry.categoryId ?? '');
          }),
        ),
      // Typed parameters (rather than a cast at the assertion) so the recorded
      // calls carry their shape — §5.1 bans naked `as`.
      update: jest.fn((_args: { data: { customFields: string } }) =>
        Promise.resolve({}),
      ),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  };

  // The delete paths run their spill and their delete in one transaction; the
  // fake hands the same client back, so the calls are still recorded. Attached
  // after the literal because it closes over the object it belongs to.
  const client = Object.assign(prisma, {
    $transaction: <R>(fn: (tx: typeof prisma) => Promise<R>): Promise<R> =>
      fn(prisma),
  });

  const i18n = { t: (key: string): string => key };
  const service = new InventoryCategoriesService(
    client as never,
    i18n as never,
  );
  return { service, prisma };
}

describe('effective properties', () => {
  it('walks up the chain while every step inherits', async () => {
    const { service } = build({
      categories: [
        category('root', 'Electronics', null, [
          property('p-maker', 'root', 'Manufacturer'),
        ]),
        category('leaf', 'Resistors', 'root', [
          property('p-res', 'leaf', 'Resistance', {
            type: 'number',
            unit: 'Ohm',
          }),
        ]),
      ],
    });

    const properties = await service.effectiveProperties('leaf');

    expect(properties.map((p) => p.name)).toEqual([
      'Resistance',
      'Manufacturer',
    ]);
    expect(properties[0]).toMatchObject({ inherited: false, unit: 'Ohm' });
    expect(properties[1]).toMatchObject({
      inherited: true,
      ownerCategoryName: 'Electronics',
    });
  });

  it('stops at a category that opted out of inheriting', async () => {
    const { service } = build({
      categories: [
        category('root', 'Electronics', null, [
          property('p-maker', 'root', 'Manufacturer'),
        ]),
        category(
          'leaf',
          'Resistors',
          'root',
          [property('p-res', 'leaf', 'Resistance')],
          false,
        ),
      ],
    });

    const properties = await service.effectiveProperties('leaf');

    expect(properties.map((p) => p.name)).toEqual(['Resistance']);
  });

  it('is empty for an item with no category', async () => {
    const { service } = build({ categories: [] });
    expect(await service.effectiveProperties(null)).toEqual([]);
  });
});

describe('name collisions', () => {
  const tree = [
    category('root', 'Electronics', null, [
      property('p-maker', 'root', 'Manufacturer'),
    ]),
    category('leaf', 'Resistors', 'root', []),
  ];

  it('refuses a name an ancestor already uses', async () => {
    const { service } = build({ categories: tree });
    await expect(
      service.addProperty('leaf', { name: 'Manufacturer', type: 'text' }),
    ).rejects.toThrow('inventory.errors.propertyNameTaken');
  });

  it('compares case-insensitively', async () => {
    const { service } = build({ categories: tree });
    await expect(
      service.addProperty('leaf', { name: '  manufacturer ', type: 'text' }),
    ).rejects.toThrow('inventory.errors.propertyNameTaken');
  });

  it('refuses a name an inheriting descendant already uses', async () => {
    const { service } = build({
      categories: [
        category('root', 'Electronics', null, []),
        category('leaf', 'Resistors', 'root', [
          property('p-pkg', 'leaf', 'Package'),
        ]),
      ],
    });
    await expect(
      service.addProperty('root', { name: 'Package', type: 'text' }),
    ).rejects.toThrow('inventory.errors.propertyNameTaken');
  });

  it('allows the name when the descendant does not inherit', async () => {
    const { service } = build({
      categories: [
        category('root', 'Electronics', null, []),
        category(
          'leaf',
          'Resistors',
          'root',
          [property('p-pkg', 'leaf', 'Package')],
          false,
        ),
      ],
    });
    await expect(
      service.addProperty('root', { name: 'Package', type: 'text' }),
    ).resolves.toMatchObject({ name: 'Package' });
  });

  it('refuses moving a category under its own descendant', async () => {
    const { service } = build({ categories: tree });
    await expect(
      service.updateCategory('root', { parentId: 'leaf' }),
    ).rejects.toThrow('inventory.errors.categoryCycle');
  });
});

describe('tree order and reorder', () => {
  it('appends a new category after its siblings', async () => {
    const { service, prisma } = build({
      categories: [
        category('a', 'Electronics', null, []),
        { ...category('b', 'Hardware', null, []), order: 1 },
      ],
    });

    await service.createCategory({ name: 'Consumables' });

    const created = prisma.itemCategory.create.mock.calls[0][0];
    expect(created.data.order).toBe(2);
  });

  it('rewrites sibling order by index and ignores ids from elsewhere', async () => {
    const tree = [
      category('a', 'A', null, []),
      { ...category('b', 'B', null, []), order: 1 },
      { ...category('c', 'C', null, []), order: 2 },
      category('x', 'X', 'a', []),
    ];
    const { service } = build({ categories: tree });

    // 'x' is not a root sibling — a payload cannot re-parent it by smuggling
    // its id into the order list.
    await service.reorderCategories({
      parentId: null,
      orderedIds: ['c', 'x', 'a', 'b'],
    });

    const byId = new Map(tree.map((entry) => [entry.id, entry]));
    expect(byId.get('c')?.order).toBe(0);
    expect(byId.get('a')?.order).toBe(1);
    expect(byId.get('b')?.order).toBe(2);
    expect(byId.get('x')?.parentId).toBe('a');
  });

  it('routes a dragged re-parent through the full move validation', async () => {
    const { service } = build({
      categories: [
        category('root', 'Electronics', null, []),
        category('leaf', 'Resistors', 'root', []),
      ],
    });

    await expect(
      service.reorderCategories({
        parentId: 'leaf',
        orderedIds: ['root'],
        movedId: 'root',
      }),
    ).rejects.toThrow('inventory.errors.categoryCycle');
  });

  it('re-parents the dragged node and orders it among its new siblings', async () => {
    const tree = [
      category('a', 'A', null, []),
      { ...category('b', 'B', null, []), order: 1 },
      category('x', 'X', 'a', []),
    ];
    const { service } = build({ categories: tree });

    await service.reorderCategories({
      parentId: 'b',
      orderedIds: ['x'],
      movedId: 'x',
    });

    const moved = tree.find((entry) => entry.id === 'x');
    expect(moved?.parentId).toBe('b');
    expect(moved?.order).toBe(0);
  });

  it('reorders a category’s own properties and ignores foreign ones', async () => {
    const tree = [
      category('c', 'Resistors', null, [
        property('p1', 'c', 'Package'),
        property('p2', 'c', 'Resistance', { order: 1 }),
      ]),
      category('other', 'Other', null, [property('p9', 'other', 'Thread')]),
    ];
    const { service } = build({ categories: tree });

    await service.reorderProperties('c', ['p2', 'p9', 'p1']);

    const properties = tree[0].properties;
    expect(properties.find((p) => p.id === 'p2')?.order).toBe(0);
    expect(properties.find((p) => p.id === 'p1')?.order).toBe(1);
    expect(tree[1].properties[0].order).toBe(0);
  });
});

describe('property shape is normalized on write', () => {
  it('drops the unit and options a text property cannot carry', async () => {
    const { service } = build({ categories: [category('c', 'C', null, [])] });
    const created = await service.addProperty('c', {
      name: 'Package',
      type: 'text',
      unit: 'Ohm',
      options: ['a'],
    });
    expect(created).toMatchObject({ unit: null, options: [] });
  });

  it('keeps the unit of a number and gives it no options', async () => {
    const { service } = build({ categories: [category('c', 'C', null, [])] });
    const created = await service.addProperty('c', {
      name: 'Resistance',
      type: 'number',
      unit: 'Ohm',
      options: ['a'],
    });
    expect(created).toMatchObject({ unit: 'Ohm', options: [] });
  });
});

describe('spill — the one data-loss rule', () => {
  const categories = [
    category('c', 'Resistors', null, [
      property('p-pkg', 'c', 'Package'),
      property('p-res', 'c', 'Resistance', { type: 'number', unit: 'Ohm' }),
    ]),
  ];
  const values: FakeValue[] = [
    {
      id: 'v1',
      componentId: 'c1',
      propertyId: 'p-pkg',
      valueText: 'SMD 0805',
      valueNumber: null,
    },
    {
      id: 'v2',
      componentId: 'c1',
      propertyId: 'p-res',
      valueText: null,
      valueNumber: 10,
    },
  ];

  it('moves values into the free-form pairs, unit included, and deletes them', async () => {
    const { service, prisma } = build({ categories, values });

    await service.spillValues('c1', undefined);

    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Package', value: 'SMD 0805' },
      { key: 'Resistance, Ohm', value: '10' },
    ]);
    expect(prisma.componentPropertyValue.deleteMany).toHaveBeenCalled();
  });

  it('keeps an existing free-form pair of the same name instead of overwriting it', async () => {
    const { service, prisma } = build({
      categories,
      values: [values[0]],
      component: {
        id: 'c1',
        categoryId: 'c',
        customFields: JSON.stringify([{ key: 'Package', value: 'DIP' }]),
      },
    });

    await service.spillValues('c1', ['p-pkg']);

    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Package', value: 'DIP' },
      { key: 'Package (2)', value: 'SMD 0805' },
    ]);
  });

  it('spills only what the next category does not define', async () => {
    const { service, prisma } = build({
      categories: [
        ...categories,
        category('c2', 'Capacitors', null, [
          property('p-pkg', 'c2', 'Package'),
        ]),
      ],
      values,
      component: { id: 'c1', categoryId: 'c2', customFields: '' },
    });

    // The component now reads as category c2, which defines p-pkg but not
    // p-res — so only the resistance is at risk.
    await service.spillForCategoryChange('c1', 'c2');

    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Resistance, Ohm', value: '10' },
    ]);
  });

  it('spills an item of the deleted category, and its properties go with it', async () => {
    const { service, prisma } = build({
      categories,
      values,
      components: [{ id: 'c1', categoryId: 'c' }],
      component: { id: 'c1', categoryId: 'c', customFields: '' },
    });

    await service.deleteCategory('c');

    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Package', value: 'SMD 0805' },
      { key: 'Resistance, Ohm', value: '10' },
    ]);
  });

  it('spills the values a DESCENDANT item inherited, which the FK cascade would have taken', async () => {
    // The item is filed under the child category and holds a value for a
    // property the PARENT declares. Deleting the parent cascades the property
    // row away — and, without this spill, the value with it.
    const { service, prisma } = build({
      categories: [...categories, category('child', 'SMD resistors', 'c', [])],
      values,
      components: [{ id: 'c2', categoryId: 'child' }],
      component: { id: 'c2', categoryId: 'child', customFields: '' },
    });

    await service.deleteCategory('c');

    expect(prisma.component.update).toHaveBeenCalled();
    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Package', value: 'SMD 0805' },
      { key: 'Resistance, Ohm', value: '10' },
    ]);
  });

  it('spills a deleted property before the row goes', async () => {
    const { service, prisma } = build({
      categories,
      values: [values[0]],
      component: { id: 'c1', categoryId: 'c', customFields: '' },
    });

    await service.deleteProperty('p-pkg');

    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Package', value: 'SMD 0805' },
    ]);
    expect(prisma.categoryProperty.delete).toHaveBeenCalled();
  });

  it('spills what a category stops inheriting when the switch goes off', async () => {
    // `leaf` holds an item with a value for the root's property. Turning
    // inheritance off takes that property out of the item's effective set —
    // the value would be unreachable, so it spills.
    const { service, prisma } = build({
      categories: [
        category('root', 'Electronics', null, [
          property('p-pkg', 'root', 'Package'),
        ]),
        category('leaf', 'Resistors', 'root', []),
      ],
      values: [values[0]],
      components: [{ id: 'c1', categoryId: 'leaf' }],
      component: { id: 'c1', categoryId: 'leaf', customFields: '' },
    });

    await service.updateCategory('leaf', { inheritProperties: false });

    const written = prisma.component.update.mock.calls[0][0];
    expect(JSON.parse(written.data.customFields)).toEqual([
      { key: 'Package', value: 'SMD 0805' },
    ]);
  });

  it('writes nothing when there is nothing to spill', async () => {
    const { service, prisma } = build({ categories, values: [] });
    await service.spillValues('c1', undefined);
    expect(prisma.component.update).not.toHaveBeenCalled();
  });
});

describe('value coercion', () => {
  it('drops a number that is not one, and a select value outside the options', async () => {
    const { service, prisma } = build({
      categories: [
        category('c', 'Resistors', null, [
          property('p-res', 'c', 'Resistance', { type: 'number' }),
          property('p-pkg', 'c', 'Package', {
            type: 'select',
            options: JSON.stringify(['SMD 0805', 'DIP']),
          }),
        ]),
      ],
      component: { id: 'c1', categoryId: 'c', customFields: '' },
    });

    await service.setValues('c1', {
      'p-res': 'about ten',
      'p-pkg': 'TO-220',
      unknown: 'x',
    });

    expect(prisma.componentPropertyValue.create).not.toHaveBeenCalled();
  });

  it('accepts a select value in a different case and stores the declared spelling', async () => {
    const { service, prisma } = build({
      categories: [
        category('c', 'Resistors', null, [
          property('p-pkg', 'c', 'Package', {
            type: 'select',
            options: JSON.stringify(['SMD 0805']),
          }),
        ]),
      ],
      component: { id: 'c1', categoryId: 'c', customFields: '' },
    });

    await service.setValues('c1', { 'p-pkg': 'smd 0805' });

    const created = prisma.componentPropertyValue.create.mock.calls[0][0];
    expect(created.data.valueText).toBe('SMD 0805');
  });
});
