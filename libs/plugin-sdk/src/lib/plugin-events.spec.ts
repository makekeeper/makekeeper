import { acceptEventDelivery } from './plugin';
import {
  EXTERNAL_EVENT_SCHEMA_VERSION,
  type ExternalWebhookEvent,
} from '@makekeeper/plugin-contract';

const event = (
  overrides: Partial<ExternalWebhookEvent> = {},
): ExternalWebhookEvent => ({
  eventId: 'evt_1',
  type: 'inventory.item.changed',
  schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
  scopeId: 's1',
  occurredAt: '2026-07-31T00:00:00.000Z',
  ...overrides,
});

describe('acceptEventDelivery', () => {
  it('refuses an unknown schemaVersion without touching handler or dedup', async () => {
    const onEvent = jest.fn(async () => undefined);
    const seen = new Set<string>();
    const res = await acceptEventDelivery(
      event({ schemaVersion: 99 }),
      seen,
      onEvent,
    );
    expect(res.status).toBe(400);
    expect(onEvent).not.toHaveBeenCalled();
    expect(seen.size).toBe(0);
  });

  it('tolerates a pre-versioning core that sends no schemaVersion', async () => {
    const onEvent = jest.fn(async () => undefined);
    const res = await acceptEventDelivery(
      event({ schemaVersion: undefined }),
      new Set(),
      onEvent,
    );
    expect(res.status).toBe(200);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('acks a duplicate without re-running the handler', async () => {
    const onEvent = jest.fn(async () => undefined);
    const seen = new Set<string>();
    await acceptEventDelivery(event(), seen, onEvent);
    const res = await acceptEventDelivery(event(), seen, onEvent);
    expect(res.status).toBe(200);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('consults the persistent store and caches its verdict in-process', async () => {
    const onEvent = jest.fn(async () => undefined);
    const has = jest.fn(async () => true);
    const seen = new Set<string>();
    await acceptEventDelivery(event(), seen, onEvent, {
      has,
      add: jest.fn(),
    });
    expect(onEvent).not.toHaveBeenCalled();
    // Second delivery answers from the in-process set — no second store read.
    await acceptEventDelivery(event(), seen, onEvent, { has, add: jest.fn() });
    expect(has).toHaveBeenCalledTimes(1);
  });

  it('remembers an event only AFTER the handler succeeded', async () => {
    const seen = new Set<string>();
    const add = jest.fn(async () => undefined);
    const failing = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      acceptEventDelivery(event(), seen, failing, {
        has: async () => false,
        add,
      }),
    ).rejects.toThrow('boom');
    expect(seen.size).toBe(0);
    expect(add).not.toHaveBeenCalled();

    // The retry the core will make after the failure runs the handler again.
    const succeeding = jest.fn(async () => undefined);
    await acceptEventDelivery(event(), seen, succeeding, {
      has: async () => false,
      add,
    });
    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('evt_1');
  });
});
