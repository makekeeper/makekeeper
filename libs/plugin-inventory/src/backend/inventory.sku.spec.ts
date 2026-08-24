import { InventoryService } from './inventory.service';

// Soft SKU duplicate check (#33 E4). The DB-level case-insensitivity is Prisma's
// job; these tests pin the service's own rules: blank SKUs never warn, the
// query is case-insensitive and excludes the edited component, and the result
// is projected to id/name/sku.

function makeService(findMany: jest.Mock): InventoryService {
  const prisma = { component: { findMany } };
  return new InventoryService(
    prisma as never,
    { t: (k: string) => k } as never,
    {} as never,
    {} as never,
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

describe('InventoryService.findBySku', () => {
  it('returns no matches for a blank SKU without querying', async () => {
    const findMany = jest.fn();
    const service = makeService(findMany);
    expect(await service.findBySku('   ')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries case-insensitively on the trimmed SKU', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = makeService(findMany);
    await service.findBySku('  ESP32  ');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sku: { equals: 'ESP32', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('excludes the edited component when excludeId is given', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = makeService(findMany);
    await service.findBySku('ESP32', 'comp_self');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'comp_self' } }),
      }),
    );
  });

  it('projects matches to id/name/sku, defaulting a null sku to empty', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'c1', name: 'Cap', sku: null }]);
    const service = makeService(findMany);
    expect(await service.findBySku('ESP32')).toEqual([
      { id: 'c1', name: 'Cap', sku: '' },
    ]);
  });
});
