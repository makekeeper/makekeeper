<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlarmClock, Trash2 } from '@lucide/vue';
import {
  Badge,
  Button,
  Modal,
  SegmentedControl,
  Switch,
  TimePicker,
  Tooltip,
  useConfirm,
  useDateFormat,
  useToastStore,
} from '@makekeeper/frontend-core';
import {
  NOTIFY_SCHEDULE_HOOK,
  type ScheduleView,
} from '@makekeeper/plugin-contract';
import {
  WEEKDAY_CODES,
  browserTimezone,
  buildRrule,
  type ReminderRepeat,
  type WeekdayCode,
} from './reminder-rule';
import { cancelSchedule, createSchedule, listSchedules } from './schedule-data';

const props = defineProps<{
  modelValue: boolean;
  // The object this reminder is about, when it was opened from one. Without it
  // the reminder stands on its own — "put the part on the printer at 10 on
  // Monday" is about nothing in the database (#313).
  entityRef?: string;
  // The day to start on, when the dialog was opened from one (a calendar cell).
  startOn?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const dates = useDateFormat();

// Read at each opening, never once at setup: a tab left open overnight would
// otherwise still offer yesterday.
const today = (): string => new Date().toISOString().slice(0, 10);

const DEFAULT_TIME = '10:00';

const title = ref('');
const repeat = ref<ReminderRepeat>('once');
const weekdays = ref<WeekdayCode[]>(['MO']);
const time = ref(DEFAULT_TIME);
const date = ref(today());
const personal = ref(true);
const saving = ref(false);
const existing = ref<ScheduleView[]>([]);

// Checked against the union without losing the literals (§5.1).
const REPEATS = [
  'once',
  'daily',
  'weekdays',
  'weekly',
] satisfies ReminderRepeat[];

const repeatOptions = computed(() =>
  REPEATS.map((value) => ({
    value,
    label: t(`schedule.reminder.repeat.${value}`),
  })),
);

// Reminders already set for this object. Shown in the same dialog because
// "remind me" and "you already asked me to" are one question, and a second one
// added blindly is how a person ends up with three of the same.
const reload = async (): Promise<void> => {
  try {
    const all = await listSchedules();
    // Opened from an object: its own reminders. Opened from nowhere: the ones
    // that are equally about nothing. Listing every reminder in the workspace
    // here would answer a question nobody asked, in a dialog about one.
    existing.value = props.entityRef
      ? all.filter((entry) => entry.ref === props.entityRef)
      : all.filter((entry) => !entry.ref);
  } catch {
    // An empty list and a failed list look identical on screen, and the wrong
    // one of the two invites a second reminder for something already set.
    existing.value = [];
    toast.error(t('schedule.reminder.listFailed'));
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // Every field, each time it opens, not just the date: the dialog outlives
    // the thing it was opened for, so a title typed for one object was still
    // sitting there when it opened on the next one.
    title.value = '';
    repeat.value = 'once';
    weekdays.value = ['MO'];
    time.value = DEFAULT_TIME;
    personal.value = true;
    // The day the dialog was opened on: a cell picked in March must not still
    // say January because the dialog was used before. With no day given it
    // goes back to today rather than keeping the last one.
    date.value = props.startOn ?? today();
    void reload();
  },
);

const close = (): void => emit('update:modelValue', false);

const toggleWeekday = (code: WeekdayCode): void => {
  weekdays.value = weekdays.value.includes(code)
    ? weekdays.value.filter((day) => day !== code)
    : [...weekdays.value, code];
};

const save = async (): Promise<void> => {
  if (!title.value.trim()) return;
  saving.value = true;
  try {
    await createSchedule({
      hookId: NOTIFY_SCHEDULE_HOOK,
      title: title.value.trim(),
      trigger: {
        kind: 'absolute',
        rrule: buildRrule({
          repeat: repeat.value,
          date: date.value,
          time: time.value,
          weekdays: weekdays.value,
        }),
        // The browser is the only thing that knows where the person is.
        timezone: browserTimezone(),
      },
      ref: props.entityRef,
      params: {
        type: 'schedule.reminder',
        titleKey: 'schedule.reminder.title',
        bodyKey: 'schedule.reminder.body',
        title: title.value.trim(),
      },
      personal: personal.value,
    });
    toast.success(t('schedule.reminder.created'));
    title.value = '';
    emit('created');
    await reload();
  } catch {
    toast.error(t('schedule.reminder.createFailed'));
  } finally {
    saving.value = false;
  }
};

const remove = async (entry: ScheduleView): Promise<void> => {
  const ok = await confirm({
    message: t('schedule.reminder.confirmDelete', { title: entry.title }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await cancelSchedule(entry.id);
  } catch {
    toast.error(t('schedule.reminder.deleteFailed'));
    return;
  }
  await reload();
};

const formatNext = (entry: ScheduleView): string =>
  entry.nextRunAt
    ? dates.dateTime(entry.nextRunAt)
    : t('schedule.reminder.noNextRun');
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="t('schedule.reminder.modalTitle')"
    width="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1.5">
        <label
          for="reminder-title"
          class="text-xs font-bold text-slate-700 dark:text-slate-300"
          >{{ t('schedule.reminder.titleLabel') }}</label
        >
        <input
          id="reminder-title"
          v-model="title"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          :placeholder="t('schedule.reminder.titlePlaceholder')"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-slate-700 dark:text-slate-300">{{
          t('schedule.reminder.repeatLabel')
        }}</span>
        <SegmentedControl
          v-model="repeat"
          :options="repeatOptions"
          :aria-label="t('schedule.reminder.repeatLabel')"
        />
      </div>

      <div v-if="repeat === 'weekly'" class="flex flex-wrap gap-2">
        <Button
          v-for="code in WEEKDAY_CODES"
          :key="code"
          :variant="weekdays.includes(code) ? 'primary' : 'ghost'"
          size="sm"
          :aria-pressed="weekdays.includes(code)"
          @click="toggleWeekday(code)"
        >
          {{ t(`schedule.reminder.weekday.${code}`) }}
        </Button>
      </div>

      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label
            for="reminder-date"
            class="text-xs font-bold text-slate-700 dark:text-slate-300"
            >{{ t('schedule.reminder.dateLabel') }}</label
          >
          <input
            id="reminder-date"
            v-model="date"
            type="date"
            class="glass-input rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label
            for="reminder-time"
            class="text-xs font-bold text-slate-700 dark:text-slate-300"
            >{{ t('schedule.reminder.timeLabel') }}</label
          >
          <TimePicker id="reminder-time" v-model="time" />
        </div>
      </div>

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm text-slate-900 dark:text-white">
            {{ t('schedule.reminder.personal') }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ t('schedule.reminder.personalHint') }}
          </p>
        </div>
        <Switch
          v-model="personal"
          :aria-label="t('schedule.reminder.personal')"
        />
      </div>

      <div v-if="existing.length" class="flex flex-col gap-2">
        <span class="text-xs font-bold text-slate-700 dark:text-slate-300">{{
          t('schedule.reminder.existing')
        }}</span>
        <!-- Each reminder is a thing, so it gets an edge: bare rows under a
             heading read as a continuation of the form above them, which is
             where they sat before. -->
        <ul class="flex flex-col gap-2">
          <li
            v-for="entry in existing"
            :key="entry.id"
            class="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] px-3 py-2"
          >
            <span
              class="flex items-center justify-center w-8 h-8 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
            >
              <AlarmClock class="w-4 h-4" />
            </span>
            <div class="flex-1 min-w-0">
              <p
                class="text-sm font-medium truncate text-slate-900 dark:text-white"
              >
                {{ entry.title }}
              </p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ formatNext(entry) }}
              </p>
            </div>
            <!-- Whose it is only worth saying when it is not just yours. -->
            <Badge v-if="!entry.personal" tone="neutral" :uppercase="false">
              {{ t('schedule.reminder.shared') }}
            </Badge>
            <Tooltip :text="t('schedule.reminder.delete')" display="contents">
              <Button
                variant="dangerGhost"
                size="icon-sm"
                :aria-label="t('schedule.reminder.delete')"
                @click="remove(entry)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </Tooltip>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="close">
        {{ t('schedule.reminder.close') }}
      </Button>
      <Button :loading="saving" :disabled="!title.trim()" @click="save">
        {{ t('schedule.reminder.create') }}
      </Button>
    </template>
  </Modal>
</template>
