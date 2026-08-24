// Public domain-event catalogue (#189, #190).
//
// This file is the ONLY place a public event name is born. The rules it
// encodes (normative text: docs/external-events.md):
//
// - A name is `<ownerPluginId>.<entity>.<verb>`, past tense — a fact that has
//   happened, never a command. The owning internal plugin decides when the
//   fact is final and publishes it; hearing the event requires the owner's
//   `<owner>:read` grant, checked at fan-out and re-checked at delivery.
// - The internal PluginEventBusService vocabulary is a separate, private
//   contract and is never bridged here. Publishing outward is always an
//   explicit act at the "fact happened" point.
// - Payload evolution is additive-only. An incompatible change of an event's
//   MEANING is a new name plus a deprecation note here. An incompatible
//   change of the ENVELOPE itself bumps EXTERNAL_EVENT_SCHEMA_VERSION — the
//   emergency hatch, subject to the same deprecation ritual; subscribers must
//   reject versions they do not know.
// - A name enters this catalogue only for a concrete consumer scenario,
//   never speculatively.

// Version of the ExternalWebhookEvent envelope shape. Bumped ONLY for an
// incompatible change of the envelope (all events at once), never for one
// event's payload — that is a new name.
export const EXTERNAL_EVENT_SCHEMA_VERSION = 1;

// ── Catalogue v1 ────────────────────────────────────────────────────────────
// Idiom: prefer the domain fact (`order.received`); the created/changed/
// deleted triad is the fallback for plain data entities.

// The ref entity type is `component` — the historical ORef name the resolvers
// answer to — while the event speaks the product noun "item" (#71).
//
// `ref`: mk://inventory/component/<id>. `changed` absent (nothing existed
// before).
export const INVENTORY_ITEM_CREATED_EVENT = 'inventory.item.created';
// `ref`: mk://inventory/component/<id>. `changed` lists updated field names.
export const INVENTORY_ITEM_CHANGED_EVENT = 'inventory.item.changed';
// `ref`: mk://inventory/component/<id> — already dangling by delivery time;
// the event is the only trace, which is exactly why deletions are announced.
export const INVENTORY_ITEM_DELETED_EVENT = 'inventory.item.deleted';
// The fact that an order's arrival was recorded (goods received), not that
// the order row was edited. `ref`: mk://logistics/order/<id>.
export const LOGISTICS_ORDER_RECEIVED_EVENT = 'logistics.order.received';
// The fact that a project was closed. `ref`: mk://projects/project/<id>.
export const PROJECTS_PROJECT_CLOSED_EVENT = 'projects.project.closed';

export const EXTERNAL_DOMAIN_EVENT_TYPES = [
  INVENTORY_ITEM_CREATED_EVENT,
  INVENTORY_ITEM_CHANGED_EVENT,
  INVENTORY_ITEM_DELETED_EVENT,
  LOGISTICS_ORDER_RECEIVED_EVENT,
  PROJECTS_PROJECT_CLOSED_EVENT,
] as const;

export type ExternalDomainEventType =
  (typeof EXTERNAL_DOMAIN_EVENT_TYPES)[number];

export const isExternalDomainEventType = (
  value: string,
): value is ExternalDomainEventType =>
  (EXTERNAL_DOMAIN_EVENT_TYPES as readonly string[]).includes(value);

// Owner of a domain event name — the plugin whose `<owner>:read` grant a
// subscriber must hold to hear it. `core.*` lifecycle events have no owner
// (no grant gates them), hence null.
export const domainEventOwner = (type: string): string | null => {
  const dot = type.indexOf('.');
  if (dot <= 0) return null;
  const owner = type.slice(0, dot);
  return owner === 'core' ? null : owner;
};
