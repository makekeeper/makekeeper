import { TagSourcesService } from './tag-sources.service';
import type { InventoryItemPropertyValuesEvent } from '@makekeeper/plugin-contract';

// The whole point of #205's inversion is that this file can exist: deciding a
// value is worth a tag is testable here, in the plugin that decides it, with no
// inventory in sight.

const ITEM = 'mk://inventory/component/item-1';
const PACKAGE = 'mk://inventory/category-property/prop-package';
const NOTE = 'mk://inventory/category-property/prop-note';

interface Row {
  id: string;
  ref: string;
}

function build(marked: string[] = []) {
  const rows: Row[] = marked.map((ref, index) => ({ id: `s${index}`, ref }));
  const assigned: Array<{ name: string; ref: string }> = [];
  const assign = jest.fn(async (name: string, ref: string) => {
    assigned.push({ name, ref });
    return { id: 't', name, color: 'slate', count: 1 };
  });

  const prisma = {
    tagSource: {
      findMany: async ({ where }: { where: { ref: { in: string[] } } }) =>
        rows.filter((row) => where.ref.in.includes(row.ref)),
      findFirst: async ({ where }: { where: { ref: string } }) =>
        rows.find((row) => row.ref === where.ref) ?? null,
      create: async ({ data }: { data: Row }) => {
        rows.push(data);
        return data;
      },
      deleteMany: async ({ where }: { where: { ref: string } }) => {
        const at = rows.findIndex((row) => row.ref === where.ref);
        if (at !== -1) rows.splice(at, 1);
        return { count: at === -1 ? 0 : 1 };
      },
    },
  };
  const i18n = { t: (key: string): string => key };

  const service = new TagSourcesService(
    prisma as never,
    { assign } as never,
    i18n as never,
  );
  return { service, assign, assigned, rows };
}

const event = (
  values: Array<{ propertyRef: string; value: string }>,
): InventoryItemPropertyValuesEvent => ({ itemRef: ITEM, values });

describe('marking a field as a tag source', () => {
  it('is idempotent — a switch already on stays on, and writes nothing new', async () => {
    const { service, rows } = build([PACKAGE]);
    await service.setSource(PACKAGE, true);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent off — turning off an unmarked field is not an error', async () => {
    const { service, rows } = build();
    await service.setSource(PACKAGE, false);
    expect(rows).toHaveLength(0);
  });

  it('refuses a ref that is not an ORef, rather than storing a key nothing matches', async () => {
    const { service } = build();
    await expect(service.setSource('prop-package', true)).rejects.toThrow(
      'tags.errors.invalidRef',
    );
  });

  it('reports status for every ref asked about, including the unmarked ones', async () => {
    const { service } = build([PACKAGE]);
    expect(await service.statusFor([PACKAGE, NOTE])).toEqual({
      [PACKAGE]: true,
      [NOTE]: false,
    });
  });
});

describe('tagging an item from the values it was created with', () => {
  it('tags only the values whose field is marked', async () => {
    const { service, assigned } = build([PACKAGE]);
    await service.onItemPropertyValues(
      event([
        { propertyRef: PACKAGE, value: 'SMD 0805' },
        { propertyRef: NOTE, value: 'from the blue drawer' },
      ]),
    );
    expect(assigned).toEqual([{ name: 'SMD 0805', ref: ITEM }]);
  });

  it('does nothing at all when no field is marked', async () => {
    const { service, assign } = build();
    await service.onItemPropertyValues(
      event([{ propertyRef: PACKAGE, value: 'SMD 0805' }]),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not query on an empty announcement', async () => {
    const { service, assign } = build([PACKAGE]);
    await service.onItemPropertyValues(event([]));
    expect(assign).not.toHaveBeenCalled();
  });

  it('skips a blank value instead of minting an empty tag', async () => {
    const { service, assign } = build([PACKAGE]);
    await service.onItemPropertyValues(
      event([{ propertyRef: PACKAGE, value: '   ' }]),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps tagging after one value fails — the item does not lose the rest', async () => {
    const { service, assign, assigned } = build([PACKAGE, NOTE]);
    assign.mockRejectedValueOnce(new Error('nope'));
    await service.onItemPropertyValues(
      event([
        { propertyRef: PACKAGE, value: 'SMD 0805' },
        { propertyRef: NOTE, value: 'blue drawer' },
      ]),
    );
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assigned).toEqual([{ name: 'blue drawer', ref: ITEM }]);
  });

  it('never throws at the caller — the emitter created an item and must keep it', async () => {
    const { service, assign } = build([PACKAGE]);
    assign.mockRejectedValue(new Error('nope'));
    await expect(
      service.onItemPropertyValues(
        event([{ propertyRef: PACKAGE, value: 'SMD 0805' }]),
      ),
    ).resolves.toBeUndefined();
  });
});
