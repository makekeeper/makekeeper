import { apiFetch, apiJson } from '@makekeeper/frontend-core';
import type { NotifyPreferences } from '@makekeeper/plugin-contract';

export interface ChannelInfo {
  channelId: string;
  labelKey: string;
  // Has something to reach the person with (a subscribed browser, a linked chat).
  linked: boolean;
  // The person's own master switch for it.
  enabled: boolean;
  // Offered by an installed container rather than by the app itself.
  external: boolean;
}

export interface TypeInfo {
  type: string;
  labelKey: string;
  pluginId: string;
}

export interface RouteInfo {
  type: string;
  channelId: string;
  enabled: boolean;
}

export interface DeliveryInfo {
  id: string;
  channelId: string;
  attempts: number;
  deliveredAt: string | null;
  deadAt: string | null;
  lastError: string | null;
}

export interface PushDevice {
  id: string;
  label: string | null;
  createdAt: string;
  // Digest of the subscription's endpoint. Only the browser holding that
  // subscription can produce the same value, which is how the list marks the
  // row a person is reading it from.
  fingerprint: string;
}

export const fetchChannels = (): Promise<ChannelInfo[]> =>
  apiJson<ChannelInfo[]>('/api/notifications/channels');

export const fetchTypes = (): Promise<TypeInfo[]> =>
  apiJson<TypeInfo[]>('/api/notifications/types');

export const fetchRoutes = (): Promise<RouteInfo[]> =>
  apiJson<RouteInfo[]>('/api/notifications/routes');

export const fetchDeliveries = (): Promise<DeliveryInfo[]> =>
  apiJson<DeliveryInfo[]>('/api/notifications/deliveries');

export const fetchPushDevices = (): Promise<PushDevice[]> =>
  apiJson<PushDevice[]>('/api/notifications/push/subscriptions');

export const removePushDevice = async (id: string): Promise<void> => {
  await apiFetch(`/api/notifications/push/subscriptions/${id}`, {
    method: 'DELETE',
  });
};

// One request per decision — a cell, a whole notification, or everything a
// plugin declares. A request per cell would let "Никакие" land half applied.
export const saveRoutes = async (
  types: string[],
  channelIds: string[],
  enabled: boolean,
): Promise<void> => {
  await apiJson('/api/notifications/routes', {
    method: 'POST',
    body: { types, channelIds, enabled },
  });
};

export const saveChannelEnabled = async (
  channelId: string,
  enabled: boolean,
): Promise<void> => {
  await apiJson(`/api/notifications/channels/${channelId}/enabled`, {
    method: 'POST',
    body: { enabled },
  });
};

export const fetchPreferences = (): Promise<NotifyPreferences> =>
  apiJson<NotifyPreferences>('/api/notifications/preferences');

export const savePreferences = (
  prefs: NotifyPreferences,
): Promise<NotifyPreferences> =>
  apiJson<NotifyPreferences>('/api/notifications/preferences', {
    method: 'PUT',
    body: prefs,
  });
