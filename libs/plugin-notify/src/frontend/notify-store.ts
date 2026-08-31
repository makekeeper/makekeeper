import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  apiFetch,
  apiJson,
  useRealtime,
  useSessionStore,
} from '@makekeeper/frontend-core';
import {
  NOTIFY_INBOX_CHANGED_EVENT,
  notifyInboxRoom,
  type NotificationView,
  type NotifyInboxChangedPayload,
} from '@makekeeper/plugin-contract';

// The inbox as the browser holds it (#307). Counts and rows are separate on
// purpose: the bell and the sidebar badges need the counts on every page, and
// the rows only when somebody opens the panel — fetching a list to render a
// number would make every page load carry an inbox it may never show.
const isInboxPayload = (value: unknown): value is NotifyInboxChangedPayload => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('unread' in value) || !('unreadByPlugin' in value)) return false;
  const byPlugin = value.unreadByPlugin;
  return (
    typeof value.unread === 'number' &&
    typeof byPlugin === 'object' &&
    byPlugin !== null &&
    Object.values(byPlugin).every((count) => typeof count === 'number')
  );
};

export const useNotifyStore = defineStore('notify', () => {
  const unread = ref(0);
  const unreadByPlugin = ref<Record<string, number>>({});
  const items = ref<NotificationView[]>([]);
  const loading = ref(false);
  let subscribedRoom: string | null = null;

  const unreadFor = computed(
    () =>
      (pluginId: string): number =>
        unreadByPlugin.value[pluginId] ?? 0,
  );

  const applyCounts = (payload: NotifyInboxChangedPayload): void => {
    unread.value = payload.unread;
    unreadByPlugin.value = payload.unreadByPlugin;
  };

  const loadCounts = async (): Promise<void> => {
    try {
      applyCounts(
        await apiJson<NotifyInboxChangedPayload>('/api/notifications/counts'),
      );
    } catch {
      // The bell is decoration on every page but the inbox: a failed count must
      // leave the shell alone, not raise a toast on every navigation.
    }
  };

  const loadItems = async (): Promise<void> => {
    loading.value = true;
    try {
      items.value = await apiJson<NotificationView[]>('/api/notifications');
    } finally {
      loading.value = false;
    }
  };

  // Join the reader's own room, and re-join when the session changes: after a
  // login the socket reconnects with new credentials and the previous room —
  // possibly nobody's — is no longer the right one.
  const connect = (): void => {
    const session = useSessionStore();
    const realtime = useRealtime();
    const room = notifyInboxRoom(session.user?.id ?? null);
    if (subscribedRoom === room) return;
    if (subscribedRoom) realtime.unsubscribe(subscribedRoom);
    subscribedRoom = room;
    realtime.subscribe(room);
    realtime.on(NOTIFY_INBOX_CHANGED_EVENT, (payload) => {
      // The socket hands back `unknown`, so the shape is proven rather than
      // asserted (§5.1) — a malformed frame leaves the counts alone.
      if (isInboxPayload(payload)) applyCounts(payload);
    });
    void loadCounts();
  };

  const markRead = async (id: string): Promise<void> => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    const row = items.value.find((item) => item.id === id);
    if (row && !row.readAt) row.readAt = new Date().toISOString();
    await loadCounts();
  };

  const markAllRead = async (): Promise<void> => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    const now = new Date().toISOString();
    items.value = items.value.map((item) => ({
      ...item,
      readAt: item.readAt ?? now,
    }));
    await loadCounts();
  };

  // Putting a notification off is the scheduler's job; the bus knows which
  // schedule to move. `false` means there was nothing to move — a notification
  // nobody scheduled — and the caller says so rather than pretending.
  const snooze = async (id: string, minutes: number): Promise<boolean> => {
    const result = await apiJson<{ ok: boolean }>(
      `/api/notifications/${id}/snooze`,
      { method: 'POST', body: { minutes } },
    );
    if (result.ok) {
      items.value = items.value.filter((item) => item.id !== id);
      await loadCounts();
    }
    return result.ok;
  };

  const remove = async (id: string): Promise<void> => {
    await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
    items.value = items.value.filter((item) => item.id !== id);
    await loadCounts();
  };

  return {
    unread,
    unreadByPlugin,
    unreadFor,
    items,
    loading,
    connect,
    loadCounts,
    loadItems,
    markRead,
    markAllRead,
    snooze,
    remove,
  };
});
