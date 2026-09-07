<script setup lang="ts">
import { computed } from 'vue';
import { Clock, ShieldCheck } from '@lucide/vue';
import {
  TELEMETRY_FIELDS,
  TELEMETRY_PENDING_ID,
  type TelemetryPayload,
} from '@makekeeper/plugin-contract';

// What an install report carries, rendered from the payload the sender built
// (#343).
//
// Shared because it is shown in two places that must never differ: the one-time
// consent dialog in the shell, and the folded explanation beside the switch in
// the Counting section of Settings. Two copies of "here is exactly what we
// send" is how one of
// them ends up out of date, and the one that goes stale is the promise.
//
// Three kinds of thing, three shapes — the first draft ran them together as
// paragraphs and the block was unreadable at exactly the moment it matters
// most, when someone is deciding:
//   * WHEN it happens — one line, in a tinted strip;
//   * WHAT is in it — a ruled list, one row per field: label, value, then the
//     explanation. Stacked, NOT a label/value grid: this block renders inside a
//     ~250px column when the chat panel is open, and Tailwind's `sm:` asks the
//     viewport, not the container — the grid version wrapped the plugin list one
//     character per line. The rules carry the structure instead;
//   * WHAT IT IS NOT — the limits, set apart at the end so a scan cannot miss
//     them.
//
// The `telemetry.*` keys it resolves belong to the core app bundle, which is
// always loaded — this component is the only thing that renders them.
defineProps<{ payload: TelemetryPayload | null }>();

const fields = computed(() => TELEMETRY_FIELDS);

// Rendering the placeholder id would read as "this is your id", which is
// exactly what it is not — an id is minted by the first "yes".
const valueOf = (payload: TelemetryPayload, key: keyof TelemetryPayload) => {
  const value = payload[key];
  return Array.isArray(value) ? value.join(', ') : String(value);
};

const isPendingId = (payload: TelemetryPayload, key: string): boolean =>
  key === 'instanceId' && payload.instanceId === TELEMETRY_PENDING_ID;
</script>

<template>
  <div v-if="payload" class="space-y-4">
    <p
      class="flex items-start gap-2.5 rounded-xl bg-slate-100 p-3 text-xs leading-relaxed text-slate-700 dark:bg-white/5 dark:text-slate-200"
    >
      <Clock
        class="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
        aria-hidden="true"
      />
      <span>{{ $t('telemetry.frequency') }}</span>
    </p>

    <dl
      class="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-white/10 dark:border-white/10"
    >
      <div v-for="field in fields" :key="field.key" class="space-y-1 p-3">
        <dt class="text-xs font-semibold text-slate-900 dark:text-white">
          {{ $t(field.labelKey) }}
        </dt>
        <dd class="min-w-0 space-y-1">
          <p
            v-if="isPendingId(payload, field.key)"
            class="text-xs italic leading-relaxed text-slate-500 dark:text-slate-400"
          >
            {{ $t('telemetry.pendingId') }}
          </p>
          <p
            v-else
            class="break-words font-mono text-xs leading-relaxed text-brand-700 dark:text-brand-300"
          >
            {{ valueOf(payload, field.key) }}
          </p>
          <p
            class="text-xxs leading-relaxed text-slate-500 dark:text-slate-400"
          >
            {{ $t(field.descriptionKey) }}
          </p>
        </dd>
      </div>
    </dl>

    <p
      class="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-slate-700 dark:text-slate-200"
    >
      <ShieldCheck
        class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
      <span>{{ $t('telemetry.limits') }}</span>
    </p>
  </div>
</template>
