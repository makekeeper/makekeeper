<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { AlarmClockOff, Bell, Check, X } from '@lucide/vue';
import {
  AnchoredPopover,
  Badge,
  Button,
  EmptyState,
  PluginSlot,
  Spinner,
  Tooltip,
  useDateFormat,
  useSlotContributions,
  useSessionStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { NotificationView } from '@makekeeper/plugin-contract';
import { useNotifyStore } from './notify-store';
import NotificationDialog from './NotificationDialog.vue';

// The inbox, where a person actually glances at it. Not a channel — the rows it
// shows ARE the notifications, so there is no delivery to succeed or fail here
// and nothing to retry (#307).
const notify = useNotifyStore();
const session = useSessionStore();
const route = useRoute();
const { t } = useI18n();
const toast = useToastStore();
const dates = useDateFormat();

// An hour is the snooze every reminder UI settles on, and the one a person can
// predict without being asked. A different interval is a change to the schedule
// itself, which is a different act and has its own screen.
const SNOOZE_MINUTES = 60;

// Past this the exact figure stops being information — "you have a lot" is the
// whole message — and a four-digit count bursts the badge riding the bell.
const BADGE_MAX = 99;

// Whoever can offer to set something up says so here — in the empty state,
// where there is nothing else to look at, and on a footer line when there is a
// list above it. Asked for rather than assumed, so the footer's rule and
// padding do not appear as an empty strip when nobody contributes (§5.10).
const inboxActions = useSlotContributions('notify.inbox.actions');

const open = ref(false);
const anchor = ref<HTMLElement | null>(null);

// Nothing is fetched before there is a reader: a shell-level fetch that fires
// pre-login is exactly what §5.8 forbids.
const ready = computed<boolean>(
  () => !session.multiuserEnabled || session.isAuthenticated,
);

onMounted(() => {
  if (ready.value) notify.connect();
});

watch(ready, (value) => {
  if (value) notify.connect();
});

watch(open, (value) => {
  if (value) void notify.loadItems();
});

// Anything in the panel that navigates closes it — the rows do it themselves,
// but a slot contribution cannot reach the popover's state, and a panel left
// hanging over the page it just sent you to is the panel not answering the
// click it took.
watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);

const title = (item: NotificationView): string =>
  t(item.titleKey, item.params ?? {});

const body = (item: NotificationView): string =>
  item.bodyKey ? t(item.bodyKey, item.params ?? {}) : '';

// The row is a glance and glances clip. Opening it shows the whole of it —
// which plugin is telling you, how many times it has repeated, what it points
// at — instead of the list growing a line per fact (#323).
const detail = ref<NotificationView | null>(null);

const openDetail = (item: NotificationView): void => {
  detail.value = item;
  // The panel closes: the dialog is its own surface, and a popover left hanging
  // over it is the panel not answering the click it took. The dialog is
  // mounted outside the popover for exactly this reason.
  open.value = false;
  if (!item.readAt) void notify.markRead(item.id);
};

const canSnooze = (item: NotificationView): boolean =>
  item.actions.some(
    (action) => action.kind === 'snooze' && action.scheduleId !== undefined,
  );

const snooze = async (item: NotificationView): Promise<void> => {
  if (await notify.snooze(item.id, SNOOZE_MINUTES)) {
    toast.success(t('notify.bell.snoozed'));
  }
};

const formatTime = (iso: string): string => dates.short(iso);
</script>

<template>
  <div ref="anchor" class="relative">
    <Button
      variant="ghost"
      size="icon-sm"
      :aria-label="t('notify.bell.label')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Bell class="w-5 h-5" />
      <!-- The count rides the button rather than sitting beside it: the bell is
           one control, and a number that can be read apart from it reads as a
           second one. -->
      <Badge
        v-if="notify.unread > 0"
        tone="brand"
        class="absolute -top-1 -right-1"
        >{{
          notify.unread > BADGE_MAX
            ? t('notify.bell.countOverflow', { max: BADGE_MAX })
            : notify.unread
        }}</Badge
      >
    </Button>

    <AnchoredPopover :open="open" :anchor="anchor" @close="open = false">
      <div
        class="glass-card w-80 max-w-[90vw] rounded-2xl overflow-hidden flex flex-col"
      >
        <div
          class="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-white/10"
        >
          <span class="text-sm font-medium text-slate-900 dark:text-white">
            {{ t('notify.bell.title') }}
          </span>
          <Button
            v-if="notify.unread > 0"
            variant="link"
            @click="notify.markAllRead()"
          >
            {{ t('notify.bell.markAllRead') }}
          </Button>
        </div>

        <div class="max-h-96 overflow-y-auto">
          <div v-if="notify.loading" class="flex justify-center py-8">
            <Spinner />
          </div>
          <!-- Nothing to report is also the moment a person thinks about what
               should reach them, so whoever can offer something says so here.
               The inbox names the slot and learns nothing about reminders
               (§5.10); with no contributor the state is simply empty. -->
          <EmptyState
            v-else-if="notify.items.length === 0"
            :icon="Bell"
            :title="t('notify.bell.empty')"
          >
            <template #action>
              <PluginSlot name="notify.inbox.actions" />
            </template>
          </EmptyState>
          <ul v-else class="divide-y divide-slate-200 dark:divide-white/10">
            <li
              v-for="item in notify.items"
              :key="item.id"
              class="flex items-start gap-2 px-4 py-3"
              :class="
                item.readAt
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-900 dark:text-white'
              "
            >
              <div class="flex-1 min-w-0">
                <button
                  type="button"
                  class="block w-full text-left text-sm font-medium break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg"
                  @click="openDetail(item)"
                >
                  {{ title(item) }}
                </button>
                <p
                  v-if="body(item)"
                  class="text-xs text-slate-500 dark:text-slate-400 mt-0.5"
                >
                  {{ body(item) }}
                </p>
                <p class="text-xxs text-slate-400 dark:text-slate-500 mt-1">
                  {{ formatTime(item.createdAt) }}
                  <template v-if="item.occurrences > 1">
                    ·
                    {{ t('notify.bell.repeats', { count: item.occurrences }) }}
                  </template>
                </p>
              </div>
              <!-- Three icons in a row, each doing something different and
                   none of them obvious: a bell with a line through it is not
                   self-evidently "later". The label a screen reader already had
                   is now shown to everyone else too. -->
              <Tooltip
                v-if="canSnooze(item)"
                :text="t('notify.bell.snooze')"
                display="contents"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('notify.bell.snooze')"
                  @click="snooze(item)"
                >
                  <AlarmClockOff class="w-4 h-4" />
                </Button>
              </Tooltip>
              <Tooltip
                v-if="!item.readAt"
                :text="t('notify.bell.markRead')"
                display="contents"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('notify.bell.markRead')"
                  @click="notify.markRead(item.id)"
                >
                  <Check class="w-4 h-4" />
                </Button>
              </Tooltip>
              <Tooltip :text="t('notify.bell.remove')" display="contents">
                <Button
                  variant="dangerGhost"
                  size="icon-sm"
                  :aria-label="t('notify.bell.remove')"
                  @click="notify.remove(item.id)"
                >
                  <X class="w-4 h-4" />
                </Button>
              </Tooltip>
            </li>
          </ul>
        </div>

        <!-- With a list above it the offer belongs on its own line, ruled off
             from the notifications: it is not one of them. Rendered only when
             somebody fills the slot, so the rule never draws under nothing. -->
        <div
          v-if="inboxActions.length && notify.items.length > 0"
          class="flex justify-end gap-2 px-4 py-2.5 border-t border-slate-200 dark:border-white/10"
        >
          <PluginSlot name="notify.inbox.actions" />
        </div>
      </div>
    </AnchoredPopover>

    <!-- Outside the popover: it renders its content behind `v-if`, and opening
         this closes it. -->
    <NotificationDialog :item="detail" @close="detail = null" />
  </div>
</template>
