<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Badge,
  Button,
  SegmentedControl,
  Select,
  Spinner,
  onReactivated,
  useSessionStore,
  useToastStore,
  type SegmentedOption,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Save } from '@lucide/vue';
import { isBleSupported } from './niimbot-driver';
import { useNiimbotSettingsStore } from './settings-store';
import { useNiimbotPrintSettingsStore } from './print-settings-store';
import NiimbotHaSettings from './NiimbotHaSettings.vue';
import {
  DENSITY_MAX,
  DENSITY_MIN,
  NIIMBOT_LABEL_TYPES,
  type NiimbotLabelType,
} from '../label-stock';

// The printer's settings panel, in two parts, because the two questions are
// different (#366):
//
// - **Print** — how hard the head burns and what roll is loaded. Facts about
//   the PRINTER, so they belong to the instance and are asked for ONCE. The
//   panel used to ask twice, once per route, purely because the Bluetooth path
//   kept them in this browser's storage and the Home Assistant path kept them
//   in the database — and a reader could only conclude that the two meant
//   different things.
// - **Where to send the job** — one row per route. Each says whether it can
//   print from here and carries only what is genuinely its own: the Bluetooth
//   row the device this browser was granted, the Home Assistant row the
//   printer on the household's server. A bridge container (#362) lands here as
//   a third row with no further work.
//
// Writing print settings is instance administration (one printer, one roll in
// it), so a non-admin reads them and is told who sets them, rather than being
// handed a form whose save would 403.

const { t } = useI18n();
const toast = useToastStore();
const session = useSessionStore();
const browser = useNiimbotSettingsStore();
const print = useNiimbotPrintSettingsStore();

const supported = isBleSupported();
const saving = ref(false);
const loading = ref(true);

const mayAdminister = computed(
  () => !session.multiuserEnabled || session.isAdmin,
);

// Density is a number the printer understands, so the segments are its own
// 1…5 — labelling them "light/normal/dark" would invent a mapping the device
// does not have.
const densityOptions = computed<SegmentedOption<string>[]>(() =>
  Array.from({ length: DENSITY_MAX - DENSITY_MIN + 1 }, (_, i) => {
    const value = String(DENSITY_MIN + i);
    return { value, label: value };
  }),
);

const labelTypeOptions = computed(() =>
  NIIMBOT_LABEL_TYPES.map((type) => ({
    value: type,
    label: t(`printingNiimbot.settings.labelType.options.${type}`),
  })),
);

const density = ref(String(print.density));
const labelType = ref<NiimbotLabelType>(print.labelType);

const load = async (): Promise<void> => {
  loading.value = true;
  // An instance that has never saved print settings takes the ones this
  // browser remembers from when they lived here, so nobody's printer quietly
  // resets to the defaults. Only an admin can write them, so only an admin
  // carries them over; everyone else just reads.
  const carried = mayAdminister.value
    ? await print.carryOverIfUnconfigured()
    : (await print.refresh(), false);
  if (carried) toast.success(t('printingNiimbot.print.carriedOver'));
  density.value = String(print.density);
  labelType.value = print.labelType;
  loading.value = false;
};

const save = async (): Promise<void> => {
  saving.value = true;
  const ok = await print.save({
    density: Number(density.value),
    labelType: labelType.value,
  });
  saving.value = false;
  if (ok) toast.success(t('printingNiimbot.print.saved'));
  else toast.error(t('printingNiimbot.print.saveFailed'));
};

onMounted(load);
// Settings keeps its panes alive, so a reopened section would otherwise show
// whatever was loaded the first time.
onReactivated(load);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-bold text-slate-900 dark:text-white">
        {{ $t('printingNiimbot.settings.title') }}
      </h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('printingNiimbot.settings.description') }}
      </p>
    </div>

    <!-- 1. The printer: one answer, whatever carries the job here. -->
    <section class="space-y-4">
      <div>
        <h4 class="text-sm font-semibold text-slate-900 dark:text-white">
          {{ $t('printingNiimbot.print.title') }}
        </h4>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('printingNiimbot.print.description') }}
        </p>
      </div>

      <div v-if="loading" class="flex justify-center py-4">
        <Spinner />
      </div>

      <template v-else-if="mayAdminister">
        <div class="space-y-2">
          <p class="text-sm font-semibold">
            {{ $t('printingNiimbot.settings.density.label') }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('printingNiimbot.settings.density.help') }}
          </p>
          <SegmentedControl
            v-model="density"
            :options="densityOptions"
            :aria-label="$t('printingNiimbot.settings.density.label')"
            size="lg"
          />
        </div>

        <div class="space-y-2">
          <label for="niimbot-label-type" class="block text-sm font-semibold">
            {{ $t('printingNiimbot.settings.labelType.label') }}
          </label>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('printingNiimbot.settings.labelType.help') }}
          </p>
          <Select
            id="niimbot-label-type"
            v-model="labelType"
            :options="labelTypeOptions"
            :aria-label="$t('printingNiimbot.settings.labelType.label')"
          />
        </div>

        <div class="flex justify-end">
          <Button :loading="saving" :icon-left="Save" @click="save">
            {{ $t('common.save') }}
          </Button>
        </div>
      </template>

      <!-- A non-admin sees what the printer is set to, and who sets it. -->
      <div v-else class="space-y-1">
        <p class="text-sm text-slate-700 dark:text-slate-200">
          {{ $t('printingNiimbot.print.density', { density: print.density }) }}
          <span class="text-slate-400 dark:text-slate-500">·</span>
          {{
            $t(`printingNiimbot.settings.labelType.options.${print.labelType}`)
          }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('printingNiimbot.print.adminOnlyNote') }}
        </p>
      </div>
    </section>

    <!-- 2. The routes: what can carry a job from here, and what each needs. -->
    <section
      class="space-y-4 border-t border-slate-200 pt-5 dark:border-white/10"
    >
      <div>
        <h4 class="text-sm font-semibold text-slate-900 dark:text-white">
          {{ $t('printingNiimbot.routes.title') }}
        </h4>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('printingNiimbot.routes.description') }}
        </p>
      </div>

      <div
        class="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-white/10"
      >
        <div class="flex items-start justify-between gap-3">
          <!-- Both rows of this list title themselves the same way; the HA row
               is a component, so the element has to match on purpose. -->
          <h5 class="text-sm font-semibold text-slate-900 dark:text-white">
            {{ $t('printingNiimbot.routes.browser.title') }}
            <span class="font-normal text-slate-400 dark:text-slate-500"
              >·</span
            >
            {{ $t('printingNiimbot.routes.browser.transport') }}
          </h5>
          <Badge :tone="supported ? 'success' : 'warning'">
            {{
              supported
                ? $t('printingNiimbot.routes.browser.ready')
                : $t('printingNiimbot.routes.browser.unsupported')
            }}
          </Badge>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{
            supported
              ? $t('printingNiimbot.routes.browser.help')
              : $t('printingNiimbot.settings.unsupported')
          }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('printingNiimbot.settings.device.label') }}:
          <span class="font-mono text-slate-600 dark:text-slate-300">{{
            browser.hasDevice
              ? browser.deviceName
              : $t('printingNiimbot.settings.device.none')
          }}</span>
        </p>
      </div>

      <NiimbotHaSettings />
    </section>
  </div>
</template>
