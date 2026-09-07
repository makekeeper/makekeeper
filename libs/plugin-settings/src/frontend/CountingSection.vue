<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  Disclosure,
  Spinner,
  Switch,
  TelemetryPayloadList,
  useDateFormat,
  useTelemetryStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import SectionShell from './SectionShell.vue';

// Whether this instance reports that it is running (#343).
//
// Its own section, below the install diagnostics, rather than a block on the
// About page: it is a decision about the INSTALLATION, like everything else on
// this page, and admin territory for the same reason — while About is the one
// section here that every user may open.
//
// The switch is also the answer for anyone who closed the one-time dialog
// without choosing, and the way out for anyone who said yes and changed their
// mind. Nothing about that is buried: the same explanation the dialog gave sits
// next to it, folded, built from the payload this instance would actually send.
const telemetry = useTelemetryStore();
const toast = useToastStore();
const { t } = useI18n();
// Dates in the app's language, not the browser's — `toLocaleString()` reads a
// different setting than the one the user chose here (#316).
const dates = useDateFormat();

onMounted(() => {
  void telemetry.load();
  // The real report, not an example of one. Reading it sends nothing.
  void telemetry.loadPreview();
});

// A switch that springs back with no word said is the worst outcome here: the
// user cannot tell whether their answer was recorded, on a question about what
// leaves their machine. The store no longer swallows a failed write, so say so.
const save = async (value: boolean): Promise<void> => {
  try {
    await telemetry.decide(value);
  } catch (err) {
    toast.error(
      apiErrorMessage(err, t('settings.updates.counting.saveFailed')),
    );
  }
};

const enabled = computed({
  get: () => telemetry.enabled,
  set: (value: boolean) => void save(value),
});

// Folded: read once, when someone wants to know what the switch means.
const detailsOpen = ref(false);
</script>

<template>
  <SectionShell
    :title="$t('settings.updates.sections.counting.title')"
    :description="$t('settings.updates.counting.description')"
  >
    <!-- Three states, because "no data" has two different causes and the reader
         deserves to know which: still arriving, or it failed. Rendering the
         same empty shell for both left a section that stayed blank forever
         with nothing to act on. -->
    <div
      v-if="!telemetry.loaded"
      class="glass-card flex justify-center rounded-2xl p-6"
    >
      <Spinner />
    </div>

    <p
      v-else-if="!telemetry.state"
      class="glass-card rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('settings.updates.counting.loadFailed') }}
    </p>

    <div v-else class="glass-card space-y-4 rounded-2xl p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <p class="min-w-0 text-sm text-slate-700 dark:text-slate-200">
          {{
            telemetry.enabled
              ? $t('settings.updates.counting.on')
              : $t('settings.updates.counting.off')
          }}
        </p>
        <Switch
          v-model="enabled"
          :disabled="telemetry.busy || !telemetry.state.endpointConfigured"
          :aria-label="$t('settings.updates.sections.counting.title')"
        />
      </div>

      <p
        v-if="!telemetry.state.endpointConfigured"
        class="text-xs text-slate-500 dark:text-slate-400"
      >
        {{ $t('settings.updates.counting.noEndpoint') }}
      </p>

      <Disclosure
        v-else
        v-model:open="detailsOpen"
        variant="inline"
        content-id="counting-details"
        :title="$t('settings.updates.counting.details')"
        :description="$t('settings.updates.counting.detailsHint')"
      >
        <div class="mt-3">
          <TelemetryPayloadList :payload="telemetry.preview" />
        </div>
      </Disclosure>

      <!-- Sized by the COLUMN, not the window: `sm:` asks the viewport, and
           this section narrows when the chat panel opens — the uuid then had a
           half-column to wrap in. `auto-fit` drops to one column on its own. -->
      <dl
        v-if="telemetry.enabled"
        class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]"
      >
        <div class="min-w-0">
          <dt
            class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.updates.counting.instanceId') }}
          </dt>
          <dd
            class="mt-1 break-words font-mono text-xs text-slate-900 dark:text-slate-100"
          >
            {{ telemetry.state.instanceId }}
          </dd>
          <dd class="text-xxs text-slate-500 dark:text-slate-400">
            {{ $t('settings.updates.counting.instanceIdHint') }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt
            class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.updates.counting.lastSent') }}
          </dt>
          <dd class="mt-1 text-sm text-slate-900 dark:text-slate-100">
            {{
              telemetry.state.lastSentAt
                ? dates.dateTime(telemetry.state.lastSentAt)
                : $t('settings.updates.counting.never')
            }}
          </dd>
          <dd
            v-if="telemetry.state.lastStatus === 'unreachable'"
            class="text-xxs text-amber-600 dark:text-amber-400"
          >
            {{ $t('settings.updates.counting.unreachable') }}
          </dd>
        </div>
      </dl>
    </div>
  </SectionShell>
</template>
