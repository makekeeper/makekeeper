import { InventoryEventsService } from './inventory-events.service';
import type {
  CapabilityRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import type { ExternalDomainEventInput } from '@makekeeper/plugin-contract';

// What matters here is the EMITTER POLICY (#192): the envelope an item
// mutation produces, and that a missing external host costs nothing and
// breaks nothing.

const makeService = (opts: {
  capability: { publishDomainEvent: jest.Mock } | null;
  scopeId?: string | null;
}) => {
  const prisma = {
    component: {
      findUnique: jest.fn(async () =>
        opts.scopeId === undefined ? null : { scopeId: opts.scopeId },
      ),
    },
  } as unknown as PrismaService;
  const capabilities = {
    getCapability: () => opts.capability,
  } as unknown as CapabilityRegistryService;
  return new InventoryEventsService(prisma, capabilities);
};

describe('InventoryEventsService', () => {
  it('publishes created/deleted with a canonical component ref and the scope', async () => {
    const publishDomainEvent = jest.fn(async () => undefined);
    const service = makeService({ capability: { publishDomainEvent } });
    await service.itemCreated({ id: 'comp_1', scopeId: 's1' });
    await service.itemDeleted({ id: 'comp_1', scopeId: 's1' });
    const [created, deleted] = publishDomainEvent.mock.calls.map(
      (c: unknown[]) => c[0] as ExternalDomainEventInput,
    );
    expect(created).toEqual({
      type: 'inventory.item.created',
      scopeId: 's1',
      ref: 'mk://inventory/component/comp_1',
    });
    expect(deleted.type).toBe('inventory.item.deleted');
  });

  it('publishes changed with field NAMES, resolving the scope when not given', async () => {
    const publishDomainEvent = jest.fn(async () => undefined);
    const service = makeService({
      capability: { publishDomainEvent },
      scopeId: 's9',
    });
    await service.itemChanged('comp_2', ['quantity']);
    expect(publishDomainEvent).toHaveBeenCalledWith({
      type: 'inventory.item.changed',
      scopeId: 's9',
      ref: 'mk://inventory/component/comp_2',
      changed: ['quantity'],
    });
  });

  it('is a silent no-op without the external host — and reads nothing', async () => {
    const service = makeService({ capability: null });
    const prisma = (
      service as unknown as {
        prisma: { component: { findUnique: jest.Mock } };
      }
    ).prisma;
    await service.itemChanged('comp_3', ['quantity']);
    await service.itemCreated({ id: 'comp_3', scopeId: null });
    expect(prisma.component.findUnique).not.toHaveBeenCalled();
  });

  it('a failing publish is swallowed — the mutation must not fail', async () => {
    const publishDomainEvent = jest.fn(async () => {
      throw new Error('outbox down');
    });
    const service = makeService({ capability: { publishDomainEvent } });
    await expect(
      service.itemCreated({ id: 'comp_4', scopeId: null }),
    ).resolves.toBeUndefined();
  });
});
