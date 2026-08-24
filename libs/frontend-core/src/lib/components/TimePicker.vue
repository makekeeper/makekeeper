<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Select from './Select.vue';

// A time of day, written the way the CHOSEN LANGUAGE writes it.
//
// `<input type="time">` follows the browser's locale, not the app's, so a
// Russian interface on a US machine offered "3:00 PM" and a English one on a
// European machine offered "15:00" — the app's own language had no say. Here
// the hour cycle comes from the app locale through Intl: 24-hour for ru, de,
// en-GB…, 12-hour with a localized AM/PM for en-US.
//
// The lists here are never searched: twenty-four hours is a list you point at,
// and a search box in front of it is one more thing between the person and the
// two clicks they came for.
//
// The VALUE never changes shape: it is always canonical `HH:MM`, 24-hour, so
// storage, comparison and the wire stay in one format and only the display
// moves. A picker that stored what it showed would make "3:00 PM" a different
// thing from "15:00".

const props = withDefaults(
  defineProps<{
    // Canonical `HH:MM`, 24-hour.
    modelValue: string;
    id?: string;
    ariaLabel?: string;
    disabled?: boolean;
    // Minutes offered, as a step. Five is enough for a schedule and keeps the
    // list readable; a caller that needs every minute passes 1.
    minuteStep?: number;
  }>(),
  { id: undefined, ariaLabel: undefined, disabled: false, minuteStep: 5 },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const { locale, t } = useI18n();

// h11/h12 ⇒ AM/PM; h23/h24 ⇒ 24-hour. Unknown locale falls back to 24-hour,
// which is the unambiguous one.
const hour12 = computed<boolean>(() => {
  try {
    return (
      new Intl.DateTimeFormat(locale.value, {
        hour: 'numeric',
      }).resolvedOptions().hour12 ?? false
    );
  } catch {
    return false;
  }
});

const parsed = computed<{ hour: number; minute: number }>(() => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(props.modelValue ?? '');
  if (!match) return { hour: 0, minute: 0 };
  return {
    hour: Math.min(23, Number(match[1])),
    minute: Math.min(59, Number(match[2])),
  };
});

const pad = (value: number): string => String(value).padStart(2, '0');

const emitValue = (hour: number, minute: number): void => {
  emit('update:modelValue', `${pad(hour)}:${pad(minute)}`);
};

// Labels come from Intl rather than from our own strings: the way an hour is
// written is a property of the language, not of this product, and there are
// too many languages to keep a table of.
const partOf = (date: Date, type: Intl.DateTimeFormatPartTypes): string => {
  const parts = new Intl.DateTimeFormat(locale.value, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: hour12.value,
    timeZone: 'UTC',
  }).formatToParts(date);
  return parts.find((part) => part.type === type)?.value ?? '';
};

const at = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 0, 1, hour, minute));

const hourOptions = computed(() => {
  if (!hour12.value) {
    return Array.from({ length: 24 }, (_, hour) => ({
      value: String(hour),
      label: pad(hour),
    }));
  }
  // 12, 1…11 — the order a 12-hour clock is read in.
  const hours = [12, ...Array.from({ length: 11 }, (_, i) => i + 1)];
  return hours.map((displayed) => ({
    value: String(displayed % 12),
    label: partOf(at(displayed % 12), 'hour'),
  }));
});

const minuteOptions = computed(() => {
  const step = Math.max(1, Math.min(30, props.minuteStep));
  const minutes: number[] = [];
  for (let minute = 0; minute < 60; minute += step) minutes.push(minute);
  // The stored value may sit between steps (set elsewhere, or by an older
  // version): show it rather than silently snapping the schedule.
  if (!minutes.includes(parsed.value.minute)) minutes.push(parsed.value.minute);
  return minutes
    .sort((a, b) => a - b)
    .map((minute) => ({ value: String(minute), label: pad(minute) }));
});

const meridiemOptions = computed(() => [
  { value: 'am', label: partOf(at(9), 'dayPeriod') },
  { value: 'pm', label: partOf(at(21), 'dayPeriod') },
]);

const meridiem = computed(() => (parsed.value.hour >= 12 ? 'pm' : 'am'));

// The hour as the 12-hour clock names it: 0 for both midnight and noon.
const hour12Value = computed(() => String(parsed.value.hour % 12));

const onHour = (value: string): void => {
  const picked = Number(value);
  const hour = hour12.value
    ? (picked % 12) + (meridiem.value === 'pm' ? 12 : 0)
    : picked;
  emitValue(hour, parsed.value.minute);
};

const onMinute = (value: string): void => {
  emitValue(parsed.value.hour, Number(value));
};

const onMeridiem = (value: string): void => {
  const base = parsed.value.hour % 12;
  emitValue(value === 'pm' ? base + 12 : base, parsed.value.minute);
};
</script>

<template>
  <div
    class="flex items-center gap-2"
    role="group"
    :aria-label="ariaLabel ?? t('common.time')"
  >
    <Select
      :id="id"
      :model-value="hour12 ? hour12Value : String(parsed.hour)"
      :options="hourOptions"
      :disabled="disabled"
      :aria-label="t('common.hours')"
      :searchable="false"
      trigger-class="min-w-20"
      @update:model-value="(v: string) => onHour(v)"
    />
    <span class="text-sm text-slate-400 dark:text-slate-500" aria-hidden="true"
      >:</span
    >
    <Select
      :model-value="String(parsed.minute)"
      :options="minuteOptions"
      :disabled="disabled"
      :aria-label="t('common.minutes')"
      :searchable="false"
      trigger-class="min-w-20"
      @update:model-value="(v: string) => onMinute(v)"
    />
    <Select
      v-if="hour12"
      :model-value="meridiem"
      :options="meridiemOptions"
      :disabled="disabled"
      :aria-label="t('common.time')"
      trigger-class="min-w-20"
      @update:model-value="(v: string) => onMeridiem(v)"
    />
  </div>
</template>
