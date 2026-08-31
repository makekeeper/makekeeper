<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  AlarmClock,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Plus,
} from '@lucide/vue';
import {
  Button,
  EmptyState,
  PageHeader,
  Select,
  Refreshable,
  SegmentedControl,
  Spinner,
  apiJson,
  useAgentDataChanged,
  useResource,
  useRouteQuery,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { CalendarItem } from '@makekeeper/plugin-contract';
import {
  dayKey,
  groupByDay,
  monthGrid,
  parseDayKey,
  rangeFor,
  shiftAnchor,
  startOfWeek,
  isShowableYear,
  yearChoices,
  type CalendarView as ViewMode,
} from './calendar-grid';
import CalendarItemDialog from './CalendarItemDialog.vue';
import ReminderModal from './ReminderModal.vue';

// One picture of what is coming, assembled from the plugins that own the dates
// (#310). Nothing here is stored: the screen asks for a window and renders the
// answer, so a moved deadline changes the calendar with no write anywhere and a
// disabled plugin simply stops contributing a layer.
const { t, locale } = useI18n();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

// Route-driven throughout: the view mode and the visible window are the URL, so
// a calendar someone links to opens where they were looking (§5.3).
const view = useRouteQuery('view', { default: 'month' });
const anchorKey = useRouteQuery('date', { default: '' });

const mode = computed<ViewMode>(() =>
  view.value === 'week' || view.value === 'agenda' ? view.value : 'month',
);
const anchor = computed<Date>(() =>
  anchorKey.value ? parseDayKey(anchorKey.value) : new Date(),
);

const window = computed(() => rangeFor(mode.value, anchor.value));

const items = useResource<CalendarItem[]>(
  (signal) =>
    apiJson<CalendarItem[]>(
      `/api/schedules/calendar?from=${window.value.from.toISOString()}&to=${window.value.to.toISOString()}`,
      { signal },
    ),
  { keepPreviousData: true },
);

watch(
  () => [mode.value, anchorKey.value] as const,
  () => void items.refetch(),
);

// A reminder the agent just set belongs on the calendar the person is looking
// at, without them reloading to find out. The signal is coarse on purpose —
// the chat only knows a turn ended, never which tools ran — so this refetches
// the window rather than guessing what changed.
watch(useAgentDataChanged(), () => void items.refetch());

const byDay = computed(() => groupByDay(items.data.value ?? []));

const grid = computed<Date[]>(() => monthGrid(anchor.value));

const weekDays = computed<Date[]>(() => {
  const start = startOfWeek(anchor.value);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
});

// The agenda lists only the days that have something: an empty Tuesday is not
// an entry, it is the absence of one.
const agendaDays = computed<{ key: string; items: CalendarItem[] }[]>(() =>
  [...byDay.value.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayItems]) => ({ key, items: dayItems })),
);

// `satisfies` rather than a cast: the literals stay literal AND are checked
// against the union, so a view added to one and not the other fails here (§5.1).
const VIEW_MODES = ['month', 'week', 'agenda'] satisfies ViewMode[];

const viewOptions = computed(() =>
  VIEW_MODES.map((value) => ({
    value,
    label: t(`schedule.calendar.view.${value}`),
  })),
);

const todayKey = dayKey(new Date());

const move = (direction: 1 | -1): void => {
  anchorKey.value = dayKey(shiftAnchor(mode.value, anchor.value, direction));
};

const goToday = (): void => {
  anchorKey.value = '';
};

// Month and year are chosen, not paged to (#314): a date a year out was twelve
// clicks away, and there was no way to name a month at all.
const monthOptions = computed(() => {
  const format = new Intl.DateTimeFormat(locale.value, { month: 'long' });
  // Formatted with the month alone, so a locale that inflects (Russian) gives
  // the standalone form — "январь", not the "января" a full date produces.
  return Array.from({ length: 12 }, (_, month) => ({
    value: String(month),
    label: format.format(new Date(2026, month, 1)),
  }));
});

const yearOptions = computed(() =>
  yearChoices(
    new Date().getFullYear(),
    anchor.value.getFullYear(),
    (items.data.value ?? []).map((item) => new Date(item.at).getFullYear()),
  ).map((year) => ({ value: String(year), label: String(year) })),
);

const monthValue = computed<string>(() => String(anchor.value.getMonth()));
const yearValue = computed<string>(() => String(anchor.value.getFullYear()));

// The same anchor the arrows move, so there is one answer to "which month is
// shown" and it lives in the URL.
const jumpTo = (year: number, month: number): void => {
  anchorKey.value = dayKey(new Date(year, month, 1));
};

const onMonth = (value: string): void => {
  jumpTo(anchor.value.getFullYear(), Number(value));
};

const onYear = (value: string): void => {
  const year = Number(value);
  if (!isShowableYear(year)) {
    // Nothing is written, so the control snaps back to the year on screen —
    // but a field that silently undoes a person's typing owes them a reason.
    toast.error(t('schedule.calendar.badYear'));
    return;
  }
  jumpTo(year, anchor.value.getMonth());
};

// Month and year say everything about a month window; a week or an agenda
// still needs its span spelled out.
const heading = computed<string>(() => {
  if (mode.value === 'month') return '';
  const start =
    mode.value === 'week' ? startOfWeek(anchor.value) : anchor.value;
  const end = new Date(window.value.to);
  end.setDate(end.getDate() - 1);
  const format = new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
  });
  return `${format.format(start)} — ${format.format(end)}`;
});

const weekdayNames = computed<string[]>(() => {
  const format = new Intl.DateTimeFormat(locale.value, { weekday: 'short' });
  // A fixed Monday, so the names come out Monday-first like the grid.
  const monday = new Date(2026, 0, 5);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + index);
    return format.format(day);
  });
});

const itemsOn = (day: Date): CalendarItem[] =>
  byDay.value.get(dayKey(day)) ?? [];

const timeOf = (item: CalendarItem): string =>
  new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
    new Date(item.at),
  );

const dayLabel = (key: string): string =>
  new Intl.DateTimeFormat(locale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parseDayKey(key));

// Every entry opens the same way, and the dialog decides what can be done with
// it. Navigating straight to the object looked right until the entry was a
// reminder about nothing: it has no page, so the click did nothing at all and
// the clipped title stayed the only thing a person could see (#322).
const opened = ref<CalendarItem | null>(null);

const open = (item: CalendarItem): void => {
  opened.value = item;
};

// How many entries a month cell shows before it gives up and counts the rest.
// Named because the slice and the "+N more" must agree; two literals three
// lines apart is how they stop agreeing.
const MONTH_CELL_ITEMS = 3;

// The day the cell could not fit, in the one view that has room for all of it.
// Route-driven like every other move here, so it is linkable and the back
// button returns to the month (§5.3).
//
// Both keys in ONE navigation, not two assignments: `useRouteQuery` builds its
// next query from `route.query`, and `router.replace` does not settle it
// synchronously — so a second assignment in the same tick reads the pre-move
// query and drops what the first one wrote. Set this way the view changed and
// the day silently did not.
const openDay = (day: Date): void => {
  void router
    .replace({ query: { ...route.query, view: 'agenda', date: dayKey(day) } })
    .catch(() => undefined);
};

const inCurrentMonth = (day: Date): boolean =>
  day.getMonth() === anchor.value.getMonth();

// A reminder about nothing in particular has no object page to be created
// from, so the calendar is where it starts (#313): this is the screen the
// question "what am I doing on Monday" is already asked on.
//
// The dialog is route state, not a component flag: that is the rule for every
// drill-down here (§5.3), and it is what lets another plugin send a person
// straight to it — the bell's empty state does exactly that (#315). The value
// is the day to start on, or `new` for no particular day.
const composeQuery = useRouteQuery('compose', { default: '' });

const composing = computed<boolean>({
  get: () => composeQuery.value !== '',
  set: (value) => {
    composeQuery.value = value ? 'new' : '';
  },
});

const composeOn = computed<string | undefined>(() =>
  /^\d{4}-\d{2}-\d{2}$/.test(composeQuery.value)
    ? composeQuery.value
    : undefined,
);

const compose = (day?: Date): void => {
  composeQuery.value = day ? dayKey(day) : 'new';
};

const dayAddLabel = (day: Date): string =>
  t('schedule.calendar.addOn', { day: dayLabel(dayKey(day)) });
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('schedule.calendar.title')" :icon="CalendarClock">
      <template #actions>
        <Button variant="primary" size="sm" @click="compose()">
          <AlarmClock class="w-4 h-4" />
          {{ t('schedule.calendar.newReminder') }}
        </Button>
      </template>
    </PageHeader>

    <ReminderModal
      v-model="composing"
      :start-on="composeOn"
      @created="items.refetch()"
    />

    <CalendarItemDialog
      :item="opened"
      @close="opened = null"
      @changed="items.refetch()"
    />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('schedule.calendar.previous')"
          @click="move(-1)"
        >
          <ChevronLeft class="w-4 h-4" />
        </Button>
        <Select
          :model-value="monthValue"
          :options="monthOptions"
          :aria-label="t('schedule.calendar.monthLabel')"
          trigger-class="min-w-44"
          @update:model-value="onMonth"
        />
        <Select
          :model-value="yearValue"
          :options="yearOptions"
          allow-custom
          :aria-label="t('schedule.calendar.yearLabel')"
          trigger-class="min-w-32"
          @update:model-value="onYear"
        />
        <span
          v-if="heading"
          class="text-sm font-medium text-slate-900 dark:text-white"
          >{{ heading }}</span
        >
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('schedule.calendar.next')"
          @click="move(1)"
        >
          <ChevronRight class="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" @click="goToday">
          {{ t('schedule.calendar.today') }}
        </Button>
      </div>
      <SegmentedControl
        v-model="view"
        :options="viewOptions"
        :aria-label="t('schedule.calendar.viewLabel')"
      />
    </div>

    <div v-if="items.loading.value" class="flex justify-center py-16">
      <Spinner />
    </div>

    <!-- A window that failed to load is not an empty window: an empty month
         grid says "nothing is planned", which is a different and wrong claim.
         -->
    <EmptyState
      v-else-if="items.error.value"
      :icon="CalendarClock"
      :title="t('schedule.calendar.loadFailed')"
      :description="items.error.value"
    >
      <template #action>
        <Button variant="secondary" @click="items.refetch()">
          {{ t('schedule.calendar.retry') }}
        </Button>
      </template>
    </EmptyState>

    <Refreshable v-else :refreshing="items.refreshing.value">
      <!-- Month: always six weeks, so the page below never jumps as months
           change length. Wide content scrolls inside its own container. -->
      <div v-if="mode === 'month'" class="overflow-x-auto">
        <div class="min-w-[44rem]">
          <div class="grid grid-cols-7 gap-px mb-1">
            <span
              v-for="name in weekdayNames"
              :key="name"
              class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400 px-2"
              >{{ name }}</span
            >
          </div>
          <div
            class="grid grid-cols-7 gap-px bg-slate-200 dark:bg-white/10 rounded-2xl overflow-hidden"
          >
            <div
              v-for="day in grid"
              :key="dayKey(day)"
              class="group min-h-24 p-2 flex flex-col gap-1 bg-white dark:bg-dark-800"
              :class="
                inCurrentMonth(day) ? '' : 'text-slate-400 dark:text-slate-600'
              "
            >
              <span class="flex items-center justify-between gap-1">
                <span
                  class="text-xs font-medium"
                  :class="
                    dayKey(day) === todayKey
                      ? 'text-brand-600 dark:text-brand-400'
                      : ''
                  "
                  >{{ day.getDate() }}</span
                >
                <!-- Quiet until the cell is hovered or the button is tabbed to:
                     a plus in every one of forty-two cells is noise, and one
                     that only exists on hover is unreachable by keyboard.
                     `coarse:` is the third way in: a touch screen never hovers,
                     so on a tablet the whole per-day add simply did not exist.
                     There it is always shown — noise beats absent. -->
                <button
                  type="button"
                  class="opacity-0 coarse:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 rounded-lg p-0.5 text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  :aria-label="dayAddLabel(day)"
                  @click="compose(day)"
                >
                  <Plus class="w-3.5 h-3.5" />
                </button>
              </span>
              <!-- A month cell cannot grow, so the title is clipped here —
                   and the entry opens, which is where the whole of it is. -->
              <button
                v-for="item in itemsOn(day).slice(0, MONTH_CELL_ITEMS)"
                :key="item.ref + item.field + item.at"
                class="w-full text-left text-xxs truncate rounded-lg px-1.5 py-0.5 bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :class="item.done ? 'opacity-50 line-through' : ''"
                @click="open(item)"
              >
                {{ item.title }}
              </button>
              <!-- The entries a month cell has no room for are still entries.
                   As plain text this counted them and offered no way to reach
                   them: the only route to the fourth reminder on a Tuesday was
                   to work out that the agenda existed. It opens the day. -->
              <button
                v-if="itemsOn(day).length > MONTH_CELL_ITEMS"
                type="button"
                class="text-left text-xxs text-slate-500 dark:text-slate-400 rounded-lg px-1.5 hover:text-brand-600 dark:hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                @click="openDay(day)"
              >
                {{
                  t('schedule.calendar.more', {
                    count: itemsOn(day).length - MONTH_CELL_ITEMS,
                  })
                }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Week: the same days, with room for the time beside each entry. -->
      <div v-else-if="mode === 'week'" class="flex flex-col gap-3">
        <div
          v-for="day in weekDays"
          :key="dayKey(day)"
          class="glass-card rounded-2xl p-4"
        >
          <p
            class="text-sm font-medium mb-2"
            :class="
              dayKey(day) === todayKey
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-slate-900 dark:text-white'
            "
          >
            {{ dayLabel(dayKey(day)) }}
          </p>
          <p
            v-if="itemsOn(day).length === 0"
            class="text-xs text-slate-500 dark:text-slate-400"
          >
            {{ t('schedule.calendar.nothing') }}
          </p>
          <ul v-else class="flex flex-col gap-1">
            <li v-for="item in itemsOn(day)" :key="item.ref + item.at">
              <button
                class="w-full text-left flex items-baseline gap-3 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :class="item.done ? 'opacity-60 line-through' : ''"
                @click="open(item)"
              >
                <span
                  class="text-xs tabular-nums text-slate-500 dark:text-slate-400"
                  >{{ timeOf(item) }}</span
                >
                <span
                  class="flex-1 text-sm text-slate-900 dark:text-white break-words"
                  >{{ item.title }}</span
                >
                <span
                  class="text-xxs text-slate-500 dark:text-slate-400 ml-auto shrink-0"
                  >{{ t(item.kindKey) }}</span
                >
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- Agenda: only the days that hold something. -->
      <div v-else class="flex flex-col gap-4">
        <EmptyState
          v-if="agendaDays.length === 0"
          :icon="CalendarClock"
          :title="t('schedule.calendar.nothingAhead')"
        />
        <div
          v-for="day in agendaDays"
          :key="day.key"
          class="flex flex-col gap-1"
        >
          <p
            class="text-xs uppercase tracking-wide"
            :class="
              day.key === todayKey
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-slate-500 dark:text-slate-400'
            "
          >
            {{ dayLabel(day.key) }}
          </p>
          <ul
            class="flex flex-col divide-y divide-slate-200 dark:divide-white/10"
          >
            <li v-for="item in day.items" :key="item.ref + item.at">
              <button
                class="w-full text-left flex items-baseline gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg"
                :class="item.done ? 'opacity-60 line-through' : ''"
                @click="open(item)"
              >
                <span
                  class="text-xs tabular-nums text-slate-500 dark:text-slate-400"
                  >{{ timeOf(item) }}</span
                >
                <span
                  class="flex-1 text-sm text-slate-900 dark:text-white break-words"
                  >{{ item.title }}</span
                >
                <span
                  class="text-xxs text-slate-500 dark:text-slate-400 ml-auto shrink-0"
                  >{{ t(item.kindKey) }}</span
                >
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Refreshable>
  </div>
</template>
