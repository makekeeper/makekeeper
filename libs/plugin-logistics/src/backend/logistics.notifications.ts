import type { NotificationTypeDeclaration } from '@makekeeper/plugin-contract';

// What logistics may tell a person (#306). One entry, because there is exactly
// one fact here somebody wants told without opening the app: the parcel came.
//
// Note where this does NOT live: not in the Telegram plugin, not in any other
// channel. Whoever is subscribed to what, and through which channel, is the
// bus's business — this file only says the fact exists and what it is called.
export const LOGISTICS_ORDER_RECEIVED_TYPE = 'logistics.order-received';

export const LOGISTICS_NOTIFICATION_TYPES: NotificationTypeDeclaration[] = [
  {
    type: LOGISTICS_ORDER_RECEIVED_TYPE,
    labelKey: 'logistics.notifications.orderReceived.label',
    defaultImportance: 'normal',
  },
];
