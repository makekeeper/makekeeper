import { InventoryService } from './inventory.service';

// Server-side search (#33 E5): findAll turns ?q= into a case-insensitive OR
// filter across the searchable columns. These tests pin the where-clause shape;
// with logistics absent (getCapability → null) the price/on-order maps are empty.

function makeService(findMany: jest.Mock): InventoryService {
  const prisma = {
    component: { findMany },
    projectComponent: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const capabilities = { getCapability: () => null };
  return new InventoryService(
    prisma as never,
    { t: (k: string) => k } as never,
    capabilities as never,
    { photosByOwner: async () => new Map() } as never,
    {
      itemCreated: async () => undefined,
      itemChanged: async () => undefined,
      itemDeleted: async () => undefined,
    } as never,
    {
      setValues: () => Promise.resolve(),
      valuesFor: () => Promise.resolve([]),
      effectivePropertiesFor: () => Promise.resolve([]),
      spillForCategoryChange: () => Promise.resolve(),
      filledValuesFor: () => Promise.resolve([]),
    } as never,
    { emit: async () => undefined } as never,
  );
}

describe('InventoryService.findAll search', () => {
  it('applies no filter for a blank query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).findAll('   ');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('applies no filter when q is omitted', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).findAll();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('builds a case-insensitive OR over the searchable fields', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).findAll('  SOP-8 ');
    const arg = findMany.mock.calls[0][0];
    const contains = { contains: 'SOP-8', mode: 'insensitive' };
    expect(arg.where.OR).toEqual([
      { name: contains },
      { sku: contains },
      { description: contains },
      // The category is a relation now (#205), and typed property values join
      // the search alongside the free-form blob.
      { categoryRef: { name: contains } },
      { propertyValues: { some: { valueText: contains } } },
      { customFields: contains },
    ]);
  });
});
