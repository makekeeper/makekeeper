import {
  EXTERNAL_DOMAIN_EVENT_TYPES,
  domainEventOwner,
  isExternalDomainEventType,
} from './external-events';

describe('domainEventOwner', () => {
  it('returns the first segment for a domain event name', () => {
    expect(domainEventOwner('inventory.item.changed')).toBe('inventory');
    expect(domainEventOwner('logistics.order.received')).toBe('logistics');
  });

  it('returns null for core lifecycle events — no grant gates them', () => {
    expect(domainEventOwner('core.scope-deleted')).toBeNull();
    expect(domainEventOwner('core.plugin-enabled')).toBeNull();
  });

  it('returns null for names with no owner segment', () => {
    expect(domainEventOwner('nodots')).toBeNull();
    expect(domainEventOwner('.leading-dot')).toBeNull();
    expect(domainEventOwner('')).toBeNull();
  });

  it('owns every catalogue name by a non-core plugin', () => {
    for (const type of EXTERNAL_DOMAIN_EVENT_TYPES) {
      expect(domainEventOwner(type)).not.toBeNull();
    }
  });
});

describe('isExternalDomainEventType', () => {
  it('accepts catalogue names and rejects everything else', () => {
    expect(isExternalDomainEventType('inventory.item.created')).toBe(true);
    expect(isExternalDomainEventType('core.scope-deleted')).toBe(false);
    expect(isExternalDomainEventType('inventory.item.exploded')).toBe(false);
  });
});
