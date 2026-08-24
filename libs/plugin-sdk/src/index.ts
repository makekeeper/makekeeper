export * from './lib/plugin';
export * from './lib/core-client';
export * from './lib/signing';
export * from './lib/ui';

// The event contract a subscriber programs against (#193), re-exported so a
// plugin author needs a single import root. The authoritative definitions
// stay in @makekeeper/plugin-contract.
export {
  EXTERNAL_DOMAIN_EVENT_TYPES,
  EXTERNAL_EVENT_PLUGIN_DISABLED,
  EXTERNAL_EVENT_PLUGIN_ENABLED,
  EXTERNAL_EVENT_SCHEMA_VERSION,
  EXTERNAL_EVENT_SCOPE_DELETED,
  INVENTORY_ITEM_CHANGED_EVENT,
  INVENTORY_ITEM_CREATED_EVENT,
  INVENTORY_ITEM_DELETED_EVENT,
  LOGISTICS_ORDER_RECEIVED_EVENT,
  PROJECTS_PROJECT_CLOSED_EVENT,
  isExternalDomainEventType,
  type ExternalDomainEventType,
  type ExternalWebhookEvent,
} from '@makekeeper/plugin-contract';
