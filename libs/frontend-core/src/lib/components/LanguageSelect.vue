<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { APP_LOCALES, parseAppLocale } from '@makekeeper/plugin-contract';
import { writeStoredLocale } from '../i18n';
import Select from './Select.vue';

// The interface-language picker, as one component rather than one per place
// that needs it.
//
// It began as inline state in the app header; the consent dialog (#343) is the
// second surface that needs it, and a dialog can appear before the header is
// reachable — a modal covers the header it would otherwise send you to. Two
// copies would be two places to forget `writeStoredLocale`, and a language that
// applies until reload but not after is a worse bug than no picker at all.
//
// Options are built from the contract's list, never a second one beside it
// (#211): the shipped bundles, the pairing QR's parameter and this picker have
// to agree, and a hand-kept list is how they stop agreeing. The label is the
// tag itself — a language name has no business being translated into the
// language you are trying to leave.
withDefaults(
  defineProps<{
    /** Overrides the trigger's chrome where the surrounding surface differs. */
    triggerClass?: string;
  }>(),
  {
    triggerClass:
      'px-2 py-1.5 h-9 bg-slate-100/60 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 !rounded-xl text-xs font-semibold',
  },
);

// The picker carries its own width instead of leaving it to each call site.
// `Select` sizes its dropdown to the trigger exactly, so a trigger left to hug
// its content gives a panel too narrow for the same label plus a tick — the tag
// then renders clipped ("E..") in the panel while reading fine in the trigger.
// The header happened to wrap it in this width and never saw that; the dialog
// did not, and did.
const WIDTH_CLASS = 'w-20';

const { locale } = useI18n();

const options = APP_LOCALES.map((value) => ({
  value,
  label: value.toUpperCase(),
}));

const current = ref(locale.value);
// Another surface (or the pairing flow) may change the language while this one
// is mounted; the trigger has to follow rather than show a stale tag.
watch(locale, (value) => {
  current.value = value;
});

const change = (value: string): void => {
  const chosen = parseAppLocale(value);
  if (!chosen) return;
  locale.value = chosen;
  writeStoredLocale(chosen);
};
</script>

<template>
  <Select
    :class="WIDTH_CLASS"
    v-model="current"
    :options="options"
    :aria-label="$t('header.language')"
    :trigger-class="triggerClass"
    @change="change"
  />
</template>
