<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bell, Blocks, ChevronDown, Smartphone, Trash2 } from '@lucide/vue';
import {
  Badge,
  Button,
  Disclosure,
  EmptyState,
  Spinner,
  Switch,
  TimePicker,
  isExternalPlugin,
  resolvePluginIcon,
  useConfirm,
  useDateFormat,
  usePluginsStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { NotifyPreferences } from '@makekeeper/plugin-contract';
import {
  fetchChannels,
  fetchDeliveries,
  fetchPreferences,
  fetchPushDevices,
  fetchRoutes,
  fetchTypes,
  removePushDevice,
  savePreferences,
  saveChannelEnabled,
  saveRoutes,
  type ChannelInfo,
  type DeliveryInfo,
  type PushDevice,
  type RouteInfo,
  type TypeInfo,
} from './notify-settings-data';
import {
  currentPushFingerprint,
  deviceLabel,
  enablePush,
} from './push-subscribe';

// One screen owns the routing decision (#311): which types reach which
// channel, when to stay quiet, which devices are connected, and what happened
// to what was sent. The alternative — every channel plugin with its own
// opinion and its own screen — is how a person ends up turning the same thing
// off in three places.
//
// Rendered as a plugin panel inside Settings → General, so the heading, the
// version badge and the card around it belong to the host: this component
// starts at the first section.
const { t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const pluginsStore = usePluginsStore();
const dates = useDateFormat();

const loading = ref(true);
const channels = ref<ChannelInfo[]>([]);
const types = ref<TypeInfo[]>([]);
const routes = ref<RouteInfo[]>([]);
const deliveries = ref<DeliveryInfo[]>([]);
const devices = ref<PushDevice[]>([]);
// The subscription this very browser holds, so its row can say so. Null while
// unknown — nothing is marked, which beats marking the wrong machine.
const myFingerprint = ref<string | null>(null);
const quietEnabled = ref(false);
const quietFrom = ref('22:00');
const quietTo = ref('07:00');
const busy = ref(false);
// The delivery log is diagnostics: read once when something did not arrive, and
// never again. Folded away rather than laid out beside the controls.
const logOpen = ref(false);

const toMinutes = (value: string): number => {
  const [hour, minute] = value.split(':');
  return Number(hour) * 60 + Number(minute);
};

const toClock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`;

const failed = ref(false);

const load = async (): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    const [channelList, typeList, routeList, deliveryList, deviceList, prefs] =
      await Promise.all([
        fetchChannels(),
        fetchTypes(),
        fetchRoutes(),
        fetchDeliveries(),
        fetchPushDevices(),
        fetchPreferences(),
      ]);
    channels.value = channelList;
    types.value = typeList;
    routes.value = routeList;
    deliveries.value = deliveryList;
    devices.value = deviceList;
    myFingerprint.value = await currentPushFingerprint();
    // A channel with nothing in it opens by itself: its list is empty, so it
    // hides nothing, and the only way to connect lives inside it.
    if (deviceList.length === 0) openChannels.value.add(PUSH_CHANNEL_ID);
    if (prefs.quietFromMinutes !== null && prefs.quietToMinutes !== null) {
      quietEnabled.value = true;
      quietFrom.value = toClock(prefs.quietFromMinutes);
      quietTo.value = toClock(prefs.quietToMinutes);
    }
  } catch {
    // A page that failed to load must say so: rendering empty sections would
    // claim there are no channels, no types and no deliveries.
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(load);

// Absent means the type's default, which is on: only a deliberate choice is
// ever written down, so an untouched matrix is an empty table.
const isOn = (type: string, channelId: string): boolean =>
  routes.value.find(
    (route) => route.type === type && route.channelId === channelId,
  )?.enabled ?? true;

// A channel that cannot deliver right now — not connected, or switched off —
// carries nothing, whatever the matrix holds. Everything the screen SHOWS is
// computed through this; the stored routes are never rewritten, so connecting a
// device brings back the choice the person made before.
const usable = (channel: ChannelInfo): boolean =>
  channel.linked && channel.enabled;

const goesTo = (type: string, channel: ChannelInfo): boolean =>
  usable(channel) && isOn(type, channel.channelId);

// "N of M" for one notification. The denominator is every installed channel,
// not just the usable ones: counting only what can deliver made the number
// vanish exactly when nothing could — the state a person opens this page in.
const destCount = (type: string): { on: number; total: number } => ({
  on: channels.value.filter((channel) => goesTo(type, channel)).length,
  total: channels.value.length,
});

const write = async (
  types: string[],
  channelIds: string[],
  value: boolean,
): Promise<void> => {
  try {
    await saveRoutes(types, channelIds, value);
  } catch {
    // The switches have already moved on screen; leaving them there would show
    // settings the server never accepted, so they are reloaded, not trusted.
    toast.error(t('notify.settings.saveFailed'));
    routes.value = await fetchRoutes();
    return;
  }
  const touched = new Set(
    types.flatMap((type) => channelIds.map((id) => `${type}@${id}`)),
  );
  routes.value = [
    ...routes.value.filter(
      (route) => !touched.has(`${route.type}@${route.channelId}`),
    ),
    ...types.flatMap((type) =>
      channelIds.map((channelId) => ({ type, channelId, enabled: value })),
    ),
  ];
};

const toggle = (
  type: string,
  channelId: string,
  value: boolean,
): Promise<void> => write([type], [channelId], value);

// Все / Никакие. One request, because it is one decision: a request per cell
// would let it land half applied and leave the screen disagreeing with the
// server.
const setAll = (types: string[], value: boolean): Promise<void> =>
  write(
    types,
    channels.value.filter(usable).map((channel) => channel.channelId),
    value,
  );

// The channel's own master switch, offered on its state chip.
const toggleChannel = async (channel: ChannelInfo): Promise<void> => {
  const next = !channel.enabled;
  try {
    await saveChannelEnabled(channel.channelId, next);
  } catch {
    toast.error(t('notify.settings.saveFailed'));
    return;
  }
  channels.value = channels.value.map((entry) =>
    entry.channelId === channel.channelId ? { ...entry, enabled: next } : entry,
  );
};

// Notifications filed by the plugin that tells you, built-in plugins first and
// installed containers after: the second list is a different promise, and
// mixing them would hide that.
interface TypeGroup {
  pluginId: string;
  label: string;
  icon: Component;
  external: boolean;
  types: TypeInfo[];
  // How many of the group's notifications reach anywhere at all.
  withDest: number;
}

const groups = computed<TypeGroup[]>(() => {
  const byPlugin = new Map<string, TypeInfo[]>();
  for (const type of types.value) {
    const bucket = byPlugin.get(type.pluginId);
    if (bucket) bucket.push(type);
    else byPlugin.set(type.pluginId, [type]);
  }
  return [...byPlugin.entries()]
    .map(([pluginId, list]) => {
      const manifest = pluginsStore.byId[pluginId];
      return {
        pluginId,
        // A plugin the registry no longer knows (uninstalled, its configured
        // types left behind) is named by its id: the one true thing left.
        label: manifest ? t(manifest.nameKey) : pluginId,
        icon: resolvePluginIcon(manifest?.icon),
        external: isExternalPlugin(pluginId),
        types: list,
        withDest: list.filter((type) => destCount(type.type).on > 0).length,
      };
    })
    .sort(
      (a, b) =>
        Number(a.external) - Number(b.external) ||
        a.label.localeCompare(b.label),
    );
});

// Several notifications can stand open at once: comparing where two of them go
// is exactly the question this list is read with, and closing one to look at
// another turns that into memory work.
const editing = ref<Set<string>>(new Set());

const isEditing = (type: string): boolean => editing.value.has(type);

const toggleEditing = (type: string): void => {
  const next = new Set(editing.value);
  if (!next.delete(type)) next.add(type);
  editing.value = next;
};

// Only push has a body to open: its devices. An external channel is a single
// statement about a connection, and a chevron over nothing is a promise the row
// cannot keep.
const expandable = (channel: ChannelInfo): boolean =>
  channel.channelId === PUSH_CHANNEL_ID;

const openChannels = ref<Set<string>>(new Set());
const isChannelOpen = (channelId: string): boolean =>
  openChannels.value.has(channelId);
const toggleChannelOpen = (channelId: string): void => {
  const next = new Set(openChannels.value);
  if (!next.delete(channelId)) next.add(channelId);
  openChannels.value = next;
};

const openGroups = ref<Set<string>>(new Set());
const isGroupOpen = (pluginId: string): boolean =>
  openGroups.value.has(pluginId);
const toggleGroup = (pluginId: string): void => {
  const next = new Set(openGroups.value);
  if (!next.delete(pluginId)) next.add(pluginId);
  openGroups.value = next;
};

const prefsPayload = (): NotifyPreferences => ({
  quietFromMinutes: quietEnabled.value ? toMinutes(quietFrom.value) : null,
  quietToMinutes: quietEnabled.value ? toMinutes(quietTo.value) : null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  // The browser is the only thing that knows the reader's language, and a
  // channel message has to be written in it rather than in the poster's.
  locale: navigator.language,
});

// Quiet hours save the moment they change, like the matrix beside them and
// like the update checker's own switch-plus-hour pair. A Save button here made
// the screen carry two different rules about when a setting takes effect, and
// nothing on it said which control belonged to the button.
//
// Silent on success, loud on failure: a time picker is two selects, so an
// approving toast per click would fire twice for one decision.
const persist = async (): Promise<void> => {
  const previous = {
    enabled: quietEnabled.value,
    from: quietFrom.value,
    to: quietTo.value,
  };
  try {
    await savePreferences(prefsPayload());
  } catch {
    // Put the controls back where the server still has them, rather than
    // showing a window nobody saved.
    quietEnabled.value = previous.enabled;
    quietFrom.value = previous.from;
    quietTo.value = previous.to;
    toast.error(t('notify.settings.saveFailed'));
  }
};

const onQuietToggle = (value: boolean): void => {
  quietEnabled.value = value;
  void persist();
};

const onQuietTime = (which: 'from' | 'to', value: string): void => {
  if (which === 'from') quietFrom.value = value;
  else quietTo.value = value;
  void persist();
};

const connectPush = async (): Promise<void> => {
  busy.value = true;
  try {
    const outcome = await enablePush(deviceLabel(navigator.userAgent));
    if (outcome.status === 'subscribed') {
      toast.success(t('notify.settings.pushConnected'));
      // Saved together with the subscription: a channel message needs the
      // language even if the person never opens quiet hours.
      await savePreferences(prefsPayload());
      // Only what the subscription changed. `load()` raises the page-wide
      // loading flag, so connecting a device blanked the whole panel into a
      // spinner and back — reading exactly like a page reload for a change
      // that touched two rows.
      await refreshDevices();
      return;
    }
    toast.error(t(`notify.settings.push.${outcome.status}`));
  } finally {
    busy.value = false;
  }
};

// The channels and their devices, re-read after something changed one of them.
const refreshDevices = async (): Promise<void> => {
  const [channelList, deviceList] = await Promise.all([
    fetchChannels(),
    fetchPushDevices(),
  ]);
  channels.value = channelList;
  devices.value = deviceList;
  myFingerprint.value = await currentPushFingerprint();
};

const forget = async (device: PushDevice): Promise<void> => {
  // Irreversible from here: only that browser can subscribe itself again, and
  // the person doing the forgetting is usually not sitting at it. Asked the
  // same way the paired-device list asks it (§5.3).
  const confirmed = await confirm({
    message: t('notify.settings.forgetConfirm', {
      name: device.label || t('notify.settings.unnamedDevice'),
    }),
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await removePushDevice(device.id);
  } catch {
    toast.error(t('notify.settings.forgetFailed'));
    return;
  }
  devices.value = devices.value.filter((entry) => entry.id !== device.id);
};

// A delivery names its channel by id, which is a technical identifier and not
// something to put in front of a person. Resolved through the installed
// channels; the raw id survives only for a channel that has since been removed,
// where it is the one true thing left to say.
const channelLabel = (channelId: string): string => {
  const channel = channels.value.find((entry) => entry.channelId === channelId);
  return channel ? t(channel.labelKey) : channelId;
};

const statusOf = (
  delivery: DeliveryInfo,
): { key: string; tone: 'success' | 'danger' | 'neutral' } => {
  if (delivery.deliveredAt) return { key: 'delivered', tone: 'success' };
  if (delivery.deadAt) return { key: 'dead', tone: 'danger' };
  return { key: 'pending', tone: 'neutral' };
};

// Counted for the channel's own row, the way a plugin group counts its
// notifications: the number is what makes a collapsed row worth reading.
const deviceCount = (channel: ChannelInfo): number =>
  expandable(channel) ? devices.value.length : 0;

const isMine = (device: PushDevice): boolean =>
  myFingerprint.value !== null && device.fingerprint === myFingerprint.value;

// Whether this browser is among the connected ones — which decides if there is
// anything left for its button to do.
const connectedHere = computed<boolean>(() => devices.value.some(isMine));

const formatTime = (iso: string): string => dates.short(iso);

const PUSH_CHANNEL_ID = 'web-push';
</script>

<template>
  <div class="flex flex-col gap-8">
    <div v-if="loading" class="flex justify-center py-16">
      <Spinner />
    </div>

    <EmptyState
      v-else-if="failed"
      :icon="Bell"
      :title="t('notify.settings.loadFailed')"
    >
      <template #action>
        <Button variant="secondary" @click="load">
          {{ t('notify.settings.retry') }}
        </Button>
      </template>
    </EmptyState>

    <template v-else>
      <!-- The sentence the rest of the page rests on. Without it every switch
           below reads as "lose this notification", which none of them do. -->
      <p class="text-sm text-slate-600 dark:text-slate-300">
        {{ t('notify.settings.inboxAlways') }}
      </p>

      <!-- ── Quiet hours: a rule about the person, so it stays at the top and
           does not sink under a growing list of channels. ─────────────────── -->
      <section class="flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-sm font-medium text-slate-900 dark:text-white">
              {{ t('notify.settings.quietHours') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {{ t('notify.settings.quietHoursHint') }}
            </p>
          </div>
          <Switch
            :model-value="quietEnabled"
            :aria-label="t('notify.settings.quietHours')"
            @update:model-value="onQuietToggle"
          />
        </div>
        <!-- Disabled, never unmounted: mounting the pickers on the switch moved
             everything below them every time somebody flipped it. -->
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex flex-col gap-1">
            <label
              for="quiet-from"
              class="text-xs transition-colors"
              :class="
                quietEnabled
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-400 dark:text-slate-500'
              "
              >{{ t('notify.settings.from') }}</label
            >
            <TimePicker
              id="quiet-from"
              :model-value="quietFrom"
              :disabled="!quietEnabled"
              @update:model-value="onQuietTime('from', $event)"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="quiet-to"
              class="text-xs transition-colors"
              :class="
                quietEnabled
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-400 dark:text-slate-500'
              "
              >{{ t('notify.settings.to') }}</label
            >
            <TimePicker
              id="quiet-to"
              :model-value="quietTo"
              :disabled="!quietEnabled"
              @update:model-value="onQuietTime('to', $event)"
            />
          </div>
        </div>
      </section>

      <!-- ── Channels. Shaped like the notification groups below: the head
           is a row outside the card, the chevron sits at its right, the master
           switch is a sibling, and what opens is a card of its own. A channel's
           devices belong INSIDE it — as a list beside the card they read as an
           unrelated leftover, which is exactly how they read. ─────────────── -->
      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-medium text-slate-900 dark:text-white">
          {{ t('notify.settings.channels') }}
        </h3>

        <div
          v-for="channel in channels"
          :key="channel.channelId"
          class="space-y-2"
        >
          <div
            class="flex items-center gap-1 rounded-xl px-1 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
          >
            <!-- A button only where there is something to open; elsewhere the
                 same row without the affordance, rather than a disabled button
                 that still invites a click. -->
            <component
              :is="expandable(channel) ? 'button' : 'div'"
              class="flex flex-1 min-w-0 items-center gap-3 px-2 py-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              :type="expandable(channel) ? 'button' : undefined"
              :aria-expanded="
                expandable(channel)
                  ? isChannelOpen(channel.channelId)
                  : undefined
              "
              :aria-controls="
                expandable(channel)
                  ? `notify-channel-${channel.channelId}`
                  : undefined
              "
              @click="
                expandable(channel) && toggleChannelOpen(channel.channelId)
              "
            >
              <span
                class="flex items-center justify-center w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
              >
                <component
                  :is="channel.external ? Blocks : Smartphone"
                  class="w-5 h-5"
                />
              </span>
              <span class="flex-1 min-w-0">
                <span
                  class="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"
                >
                  {{ t(channel.labelKey) }}
                  <Badge
                    v-if="channel.external"
                    tone="warning"
                    :uppercase="false"
                  >
                    {{ t('notify.settings.externalChannel') }}
                  </Badge>
                </span>
                <span class="block text-xs text-slate-500 dark:text-slate-400">
                  {{
                    channel.external
                      ? t('notify.settings.externalHint')
                      : t('notify.settings.devicesHint')
                  }}
                </span>
              </span>
              <Badge
                v-if="expandable(channel)"
                :tone="deviceCount(channel) > 0 ? 'brand' : 'neutral'"
                :uppercase="false"
              >
                {{
                  deviceCount(channel) > 0
                    ? t('notify.settings.devicesOn', {
                        count: deviceCount(channel),
                      })
                    : t('notify.settings.noDevices')
                }}
              </Badge>
              <ChevronDown
                v-if="expandable(channel)"
                class="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200"
                :class="{ '-rotate-90': !isChannelOpen(channel.channelId) }"
              />
            </component>

            <!-- The state IS the master switch: while a channel is connected,
                 pressing it stops using the channel altogether, and nothing
                 goes there whatever the list below says. -->
            <Badge v-if="!channel.linked" tone="warning" :uppercase="false">
              {{ t('notify.settings.notConnected') }}
            </Badge>
            <button
              v-else
              type="button"
              role="switch"
              :aria-checked="channel.enabled"
              class="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              @click="toggleChannel(channel)"
            >
              <Badge
                :tone="channel.enabled ? 'success' : 'neutral'"
                :uppercase="false"
              >
                {{
                  channel.enabled
                    ? t('notify.settings.connected')
                    : t('notify.settings.channelOff')
                }}
              </Badge>
            </button>
          </div>

          <div
            v-if="expandable(channel)"
            v-show="isChannelOpen(channel.channelId)"
            :id="`notify-channel-${channel.channelId}`"
            class="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
          >
            <div
              v-for="device in devices"
              :key="device.id"
              class="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-white/5"
            >
              <span class="flex-1 min-w-0 truncate text-sm">
                {{ device.label || t('notify.settings.unnamedDevice') }}
                <span
                  v-if="isMine(device)"
                  class="ml-2 text-xxs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400"
                >
                  {{ t('notify.settings.thisDevice') }}
                </span>
              </span>
              <span class="text-xs text-slate-500 dark:text-slate-400">
                {{ formatTime(device.createdAt) }}
              </span>
              <Button
                variant="dangerGhost"
                size="icon-sm"
                :aria-label="t('notify.settings.forgetDevice')"
                @click="forget(device)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>

            <!-- This browser can only ever subscribe itself: the old "connect
                 another device" button pressed here re-subscribed the very same
                 machine. So it appears while there is something to connect, and
                 gives way to the one instruction that actually works. -->
            <div
              class="flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-white/[0.03]"
            >
              <Button
                v-if="!connectedHere"
                variant="primary"
                size="sm"
                :disabled="busy"
                @click="connectPush"
              >
                {{ t('notify.settings.connectPush') }}
              </Button>
              <p class="text-xs text-slate-500 dark:text-slate-400 max-w-prose">
                {{
                  connectedHere
                    ? t('notify.settings.connectElsewhere')
                    : t('notify.settings.connectHere')
                }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Notifications, filed by the plugin that tells you. Shaped like
           Settings → Interface mode: a group header outside the card, the rows
           inside it, and the chevron at the right of whatever opens. ──────── -->
      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-medium text-slate-900 dark:text-white">
          {{ t('notify.settings.matrix') }}
        </h3>

        <div v-for="group in groups" :key="group.pluginId" class="space-y-2">
          <!-- The highlight belongs to the ROW, not to the button inside it:
               "Все"/"Никакие" are siblings (a button inside a button is invalid
               and unreachable by keyboard), and a highlight on the button alone
               stopped where the row carries on. -->
          <div
            class="flex items-center gap-1 rounded-xl px-1 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
          >
            <button
              type="button"
              class="flex flex-1 min-w-0 items-center gap-3 px-2 py-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              :aria-expanded="isGroupOpen(group.pluginId)"
              :aria-controls="`notify-group-${group.pluginId}`"
              @click="toggleGroup(group.pluginId)"
            >
              <span
                class="flex items-center justify-center w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
              >
                <component :is="group.icon" class="w-5 h-5" />
              </span>
              <span
                class="flex-1 min-w-0 truncate text-sm font-bold text-slate-900 dark:text-white"
                >{{ group.label }}</span
              >
              <Badge v-if="group.external" tone="warning" :uppercase="false">
                {{ t('notify.settings.externalPlugin') }}
              </Badge>
              <Badge tone="neutral" :uppercase="false">
                {{
                  t('notify.settings.ofTotal', {
                    on: group.withDest,
                    total: group.types.length,
                  })
                }}
              </Badge>
              <ChevronDown
                class="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200"
                :class="{ '-rotate-90': !isGroupOpen(group.pluginId) }"
              />
            </button>
            <Button
              variant="ghost"
              size="sm"
              @click="
                setAll(
                  group.types.map((entry) => entry.type),
                  true,
                )
              "
            >
              {{ t('notify.settings.all') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              @click="
                setAll(
                  group.types.map((entry) => entry.type),
                  false,
                )
              "
            >
              {{ t('notify.settings.none') }}
            </Button>
          </div>

          <div
            v-show="isGroupOpen(group.pluginId)"
            :id="`notify-group-${group.pluginId}`"
            class="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
          >
            <template v-for="type in group.types" :key="type.type">
              <div
                class="flex items-center gap-1 px-2 py-1 border-t first:border-t-0 border-slate-100 dark:border-white/5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
              >
                <button
                  type="button"
                  class="flex flex-1 min-w-0 items-center gap-3 px-2 py-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                  :aria-expanded="isEditing(type.type)"
                  :aria-controls="`notify-dest-${type.type}`"
                  @click="toggleEditing(type.type)"
                >
                  <span
                    class="flex-1 min-w-0 truncate text-sm text-slate-600 dark:text-slate-300"
                    >{{ t(type.labelKey) }}</span
                  >
                  <Badge
                    :tone="destCount(type.type).on > 0 ? 'brand' : 'neutral'"
                    :uppercase="false"
                  >
                    {{
                      t('notify.settings.ofTotal', {
                        on: destCount(type.type).on,
                        total: destCount(type.type).total,
                      })
                    }}
                  </Badge>
                  <ChevronDown
                    class="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200"
                    :class="{ '-rotate-90': !isEditing(type.type) }"
                  />
                </button>
                <!-- Accent, not grey: grey marks the unavailable on this screen,
                     and an action painted like the unavailable reads as off. -->
                <Button
                  variant="link"
                  size="sm"
                  @click="setAll([type.type], true)"
                >
                  {{ t('notify.settings.all') }}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  @click="setAll([type.type], false)"
                >
                  {{ t('notify.settings.none') }}
                </Button>
              </div>

              <div
                v-if="isEditing(type.type)"
                :id="`notify-dest-${type.type}`"
                class="px-4 py-2 pl-8 bg-slate-50 dark:bg-white/[0.03]"
              >
                <div
                  v-for="channel in channels"
                  :key="channel.channelId"
                  class="flex items-center gap-3 py-2 border-t first:border-t-0 border-slate-200 dark:border-white/10"
                >
                  <span class="flex-1 min-w-0 text-sm truncate">
                    {{ t(channel.labelKey) }}
                    <span class="text-xs text-slate-400 dark:text-slate-500">
                      {{
                        !channel.linked
                          ? t('notify.settings.whyNotConnected')
                          : !channel.enabled
                            ? t('notify.settings.whyOff')
                            : ''
                      }}
                    </span>
                  </span>
                  <!-- A channel that cannot deliver shows OFF, not a greyed-out
                       ON: a grey ON promises delivery that will not happen. The
                       stored choice is untouched, so connecting brings it back. -->
                  <Switch
                    :model-value="goesTo(type.type, channel)"
                    :disabled="!usable(channel)"
                    :aria-label="`${t(type.labelKey)} — ${t(channel.labelKey)}`"
                    @update:model-value="
                      toggle(type.type, channel.channelId, $event)
                    "
                  />
                </div>
                <div
                  class="flex items-center gap-3 py-2 border-t border-slate-200 dark:border-white/10"
                >
                  <span
                    class="flex-1 min-w-0 text-sm truncate text-slate-500 dark:text-slate-400"
                  >
                    {{ t('notify.settings.inApp') }}
                  </span>
                  <Switch
                    :model-value="true"
                    disabled
                    :aria-label="t('notify.settings.inApp')"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- ── What actually happened: diagnostics, folded away ─────────────── -->
      <Disclosure
        v-if="deliveries.length"
        v-model:open="logOpen"
        :title="t('notify.settings.log')"
        :description="t('notify.settings.logHint')"
        content-id="notify-delivery-log"
      >
        <ul
          class="flex flex-col divide-y divide-slate-200 dark:divide-white/10"
        >
          <li
            v-for="delivery in deliveries"
            :key="delivery.id"
            class="flex items-center gap-3 py-2 text-sm"
          >
            <span class="w-28 shrink-0 truncate">{{
              channelLabel(delivery.channelId)
            }}</span>
            <Badge :tone="statusOf(delivery).tone" :uppercase="false">{{
              t(`notify.settings.status.${statusOf(delivery).key}`)
            }}</Badge>
            <span
              v-if="delivery.lastError"
              class="text-xs text-slate-500 dark:text-slate-400 truncate"
              >{{ delivery.lastError }}</span
            >
            <span
              class="ml-auto text-xs text-slate-500 dark:text-slate-400 shrink-0"
              >{{
                t('notify.settings.attempts', { count: delivery.attempts })
              }}</span
            >
          </li>
        </ul>
      </Disclosure>
    </template>
  </div>
</template>
