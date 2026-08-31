<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  Button,
  Disclosure,
  Modal,
  ObjectRefLink,
  Spinner,
  resolveObjectRefRoute,
  useConfirm,
  useDateFormat,
  useToastStore,
} from '@makekeeper/frontend-core';
import {
  parseObjectRef,
  type CalendarItem,
  type ScheduleView,
} from '@makekeeper/plugin-contract';
import { cancelSchedule, fetchSchedule } from './schedule-data';

// What one entry on the calendar actually is (#322).
//
// A month cell is a couple of centimetres wide and cannot grow, so its title is
// clipped. The first answer to that was a tooltip, which only works for text
// short enough to fit in a bubble and does not exist on a touch screen. The
// entry is a thing, so it opens — with the whole text, what it points at, who
// set it and when it last ran.
const props = defineProps<{ item: CalendarItem | null }>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const router = useRouter();
const dates = useDateFormat();
const toast = useToastStore();
const confirm = useConfirm();

// A reminder is the scheduler's own entry, and the only kind this dialog may
// read in full or delete: every other date belongs to the plugin that owns it,
// and the calendar knows only what that plugin published.
const scheduleId = computed<string | null>(() => {
  if (!props.item) return null;
  const parsed = parseObjectRef(props.item.ref);
  return parsed?.pluginId === 'schedule' && parsed.entityType === 'schedule'
    ? parsed.entityId
    : null;
});

// Where the entry lives, when it lives anywhere. A reminder about nothing has
// no page, and this dialog is then the whole of it.
const objectRef = computed<string | null>(() => {
  if (!props.item) return null;
  if (!scheduleId.value) return props.item.ref;
  return schedule.value?.ref ?? null;
});

const objectRoute = computed(() =>
  objectRef.value ? resolveObjectRefRoute(objectRef.value) : null,
);

const schedule = ref<ScheduleView | null>(null);
const loading = ref(false);
// Closed each time the dialog opens: the technical half is for the times
// something has gone wrong, not the default reading of an entry.
const advanced = ref(false);

// Loaded per opening rather than held: a schedule that fired, was snoozed or
// was deleted between two openings would otherwise be described as it was the
// first time.
watch(
  () => props.item,
  async (item) => {
    schedule.value = null;
    advanced.value = false;
    const id = item ? scheduleId.value : null;
    if (!id) return;
    loading.value = true;
    try {
      schedule.value = await fetchSchedule(id);
    } catch {
      // The entry itself is still worth showing: it came from the window this
      // screen already loaded, and the extra detail is what failed, not it.
      toast.error(t('schedule.calendar.detailFailed'));
    } finally {
      loading.value = false;
    }
  },
);

const openObject = async (): Promise<void> => {
  const target = objectRoute.value;
  if (!target) return;
  emit('close');
  await router.push(target);
};

const remove = async (): Promise<void> => {
  const id = scheduleId.value;
  if (!id) return;
  const ok = await confirm({
    message: t('schedule.reminder.confirmDelete', {
      title: props.item?.title ?? '',
    }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await cancelSchedule(id);
  } catch {
    toast.error(t('schedule.reminder.deleteFailed'));
    return;
  }
  emit('changed');
  emit('close');
};
</script>

<template>
  <Modal
    :model-value="item !== null"
    :title="t('schedule.calendar.entry')"
    width="md"
    @update:model-value="emit('close')"
  >
    <div v-if="item" class="flex flex-col gap-5">
      <p
        class="text-base font-medium text-slate-900 dark:text-white break-words"
      >
        {{ item.title }}
      </p>

      <!-- What a person came here for: when it happens, and what it is about.
           Everything else is for the times something has gone wrong with it,
           and lives behind the fold below. -->
      <dl class="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-slate-500 dark:text-slate-400">
          {{ t('schedule.calendar.when') }}
        </dt>
        <dd class="text-slate-900 dark:text-white">
          {{ dates.dateTime(item.at) }}
          <template v-if="item.endsAt">
            — {{ dates.dateTime(item.endsAt) }}
          </template>
        </dd>

        <template v-if="objectRef">
          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('schedule.calendar.about') }}
          </dt>
          <dd>
            <!-- A link to the object by its own name. A printed mk:// is
                 protocol, not information — and the entry's own title is a
                 better stand-in than a stand-in, for the frame before the
                 name arrives and for the lookup that never answers. -->
            <ObjectRefLink :ref-string="objectRef" :fallback="item.title" />
          </dd>
        </template>
      </dl>

      <Disclosure
        v-model:open="advanced"
        :title="t('schedule.calendar.advanced')"
        content-id="calendar-entry-advanced"
        variant="inline"
      >
        <dl class="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm pt-2">
          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('schedule.calendar.kindLabel') }}
          </dt>
          <dd class="text-slate-900 dark:text-white">
            {{ t(item.kindKey) }}
            <span v-if="item.done" class="text-slate-500 dark:text-slate-400">
              · {{ t('schedule.calendar.doneAlready') }}
            </span>
          </dd>

          <template v-if="schedule">
            <dt class="text-slate-500 dark:text-slate-400">
              {{ t('schedule.calendar.lastRun') }}
            </dt>
            <dd class="text-slate-900 dark:text-white">
              {{
                schedule.lastRunAt
                  ? dates.dateTime(schedule.lastRunAt)
                  : t('schedule.calendar.neverRan')
              }}
            </dd>

            <dt class="text-slate-500 dark:text-slate-400">
              {{ t('schedule.calendar.nextRun') }}
            </dt>
            <dd class="text-slate-900 dark:text-white">
              {{
                schedule.nextRunAt
                  ? dates.dateTime(schedule.nextRunAt)
                  : t('schedule.reminder.noNextRun')
              }}
            </dd>

            <dt class="text-slate-500 dark:text-slate-400">
              {{ t('schedule.calendar.createdBy') }}
            </dt>
            <dd class="text-slate-900 dark:text-white">
              {{
                schedule.createdByName || t('schedule.calendar.creatorUnknown')
              }}
              <span class="text-slate-500 dark:text-slate-400">
                · {{ dates.dateTime(schedule.createdAt) }}
              </span>
            </dd>

            <dt class="text-slate-500 dark:text-slate-400">
              {{ t('schedule.reminder.personal') }}
            </dt>
            <dd class="text-slate-900 dark:text-white">
              {{
                schedule.personal
                  ? t('schedule.calendar.onlyYou')
                  : t('schedule.reminder.shared')
              }}
            </dd>

            <template v-if="schedule.trigger.kind === 'absolute'">
              <dt class="text-slate-500 dark:text-slate-400">
                {{ t('schedule.calendar.rule') }}
              </dt>
              <!-- Verbatim: it is what the schedule will actually do, and a
                   prose retelling that drifts from it is worse than the line. -->
              <dd
                class="font-mono text-xxs break-all text-slate-600 dark:text-slate-300"
              >
                {{ schedule.trigger.rrule }}
                <span class="text-slate-500 dark:text-slate-400">
                  · {{ schedule.trigger.timezone }}
                </span>
              </dd>
            </template>
          </template>

          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('schedule.calendar.reference') }}
          </dt>
          <dd class="flex flex-col gap-1">
            <span
              class="font-mono text-xxs break-all text-slate-600 dark:text-slate-300"
              >{{ item.ref }}</span
            >
            <span
              v-if="objectRef && objectRef !== item.ref"
              class="font-mono text-xxs break-all text-slate-600 dark:text-slate-300"
              >{{ objectRef }}</span
            >
          </dd>
        </dl>
      </Disclosure>

      <div v-if="loading" class="flex justify-center py-2">
        <Spinner />
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="emit('close')">
        {{ t('schedule.reminder.close') }}
      </Button>
      <Button v-if="scheduleId" variant="dangerGhost" @click="remove">
        {{ t('schedule.reminder.delete') }}
      </Button>
      <Button v-if="objectRoute" @click="openObject">
        {{ t('schedule.calendar.openObject') }}
      </Button>
    </template>
  </Modal>
</template>
