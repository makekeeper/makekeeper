<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { BarChart3 } from '@lucide/vue';
import { apiJson, Badge, EmptyState, Spinner } from '@makekeeper/frontend-core';

// Real provider-usage telemetry (ticket #55): one mini-chart per provider+model
// combining all three measures — a solid line for requests, a dashed line for
// tokens (each normalized to the row's own max; the tooltip shows raw values)
// and red bars behind the curves for errors (scaled to the global error max so
// rows stay comparable). Data comes from the stats grouped-series API
// (chat.usage.requests / tokens / errors), merged per provider+model here.
interface ProviderDayUsage {
  requests: number;
  tokens: number;
  errors: number;
}
interface ProviderUsage {
  name: string;
  colorClass: string;
  days: ProviderDayUsage[];
}
interface GroupedSeries {
  dimensions: Record<string, string>;
  points: { date: string; value: number }[];
}

// Fixed hue order (never cycled) — CVD-validated steps, extended past the demo's
// three so a 4th/5th provider still gets a distinct, accessible colour.
const PALETTE = [
  'text-brand-500',
  'text-emerald-600',
  'text-amber-600',
  'text-sky-600',
  'text-violet-600',
  'text-rose-600',
];
const DAYS = 14;

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const providers = ref<ProviderUsage[]>([]);
const dates = ref<Date[]>([]);

const dimKey = (d: Record<string, string>): string =>
  `${d.provider ?? ''}|${d.model ?? ''}`;

onMounted(async () => {
  try {
    const [req, tok, err] = await Promise.all([
      apiJson<GroupedSeries[]>(
        `/api/stats/series-grouped?metric=chat.usage.requests&days=${DAYS}`,
      ),
      apiJson<GroupedSeries[]>(
        `/api/stats/series-grouped?metric=chat.usage.tokens&days=${DAYS}`,
      ),
      apiJson<GroupedSeries[]>(
        `/api/stats/series-grouped?metric=chat.usage.errors&days=${DAYS}`,
      ),
    ]);

    // All series are densified to the same day keys, so any non-empty group
    // gives the shared date axis.
    const dateStrings =
      [...req, ...tok, ...err][0]?.points.map((p) => p.date) ?? [];
    dates.value = dateStrings.map((s) => new Date(s));

    const values = (series: GroupedSeries[]): Map<string, number[]> => {
      const m = new Map<string, number[]>();
      for (const g of series)
        m.set(
          dimKey(g.dimensions),
          g.points.map((p) => p.value),
        );
      return m;
    };
    const reqMap = values(req);
    const tokMap = values(tok);
    const errMap = values(err);

    // Union of provider+model combinations across the three measures, in a
    // stable (sorted) order so hue assignment is deterministic.
    const keys = [
      ...new Set([...reqMap.keys(), ...tokMap.keys(), ...errMap.keys()]),
    ].sort();
    const labelFor = new Map<string, string>();
    for (const g of [...req, ...tok, ...err]) {
      const k = dimKey(g.dimensions);
      if (!labelFor.has(k)) {
        labelFor.set(
          k,
          [g.dimensions.provider, g.dimensions.model]
            .filter(Boolean)
            .join(' / ') || k,
        );
      }
    }

    providers.value = keys.map((k, idx) => ({
      name: labelFor.get(k) ?? k,
      colorClass: PALETTE[idx] ?? 'text-slate-500',
      days: dateStrings.map((_, i) => ({
        requests: reqMap.get(k)?.[i] ?? 0,
        tokens: tokMap.get(k)?.[i] ?? 0,
        errors: errMap.get(k)?.[i] ?? 0,
      })),
    }));
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});

const totals = computed<{ requests: number; tokens: number; errors: number }>(
  () => {
    const acc = { requests: 0, tokens: 0, errors: 0 };
    for (const p of providers.value)
      for (const d of p.days) {
        acc.requests += d.requests;
        acc.tokens += d.tokens;
        acc.errors += d.errors;
      }
    return acc;
  },
);

const hasData = computed<boolean>(() => providers.value.length > 0);

const fmt = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }),
);

// Chart geometry: fixed viewBox stretched by the container.
const W = 100;
const H = 32;
const PAD_Y = 3;

const dayLabel = (i: number): string =>
  dates.value[i]?.toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
  }) ?? '';

// Reactive geometry — data loads after mount, so these derive from the refs.
const step = computed<number>(() => W / Math.max(1, dates.value.length - 1));
const xOf = (i: number): number => i * step.value;
const yOf = (value: number, max: number): number =>
  H - PAD_Y - (value / max) * (H - PAD_Y * 2);

// Errors share one scale across rows so a taller bar always means more errors.
const maxErrors = computed<number>(() =>
  Math.max(1, ...providers.value.flatMap((p) => p.days.map((d) => d.errors))),
);

interface ErrorBar {
  x: number;
  height: number;
}

interface Row {
  name: string;
  colorClass: string;
  requestsPath: string;
  tokensPath: string;
  errorBars: ErrorBar[];
  tokens: number;
  requests: number;
  errors: number;
}

const lineOf = (values: number[]): string => {
  const max = Math.max(1, ...values);
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(v, max)}`)
    .join(' ');
};

const BAR_WIDTH = computed<number>(() => step.value * 0.5);

const rows = computed<Row[]>(() =>
  providers.value.map((p) => ({
    name: p.name,
    colorClass: p.colorClass,
    requestsPath: lineOf(p.days.map((d) => d.requests)),
    tokensPath: lineOf(p.days.map((d) => d.tokens)),
    errorBars: p.days.flatMap((d, i) =>
      d.errors > 0
        ? [
            {
              x: xOf(i) - BAR_WIDTH.value / 2,
              height: (d.errors / maxErrors.value) * (H - PAD_Y * 2),
            },
          ]
        : [],
    ),
    tokens: p.days.reduce((acc, d) => acc + d.tokens, 0),
    requests: p.days.reduce((acc, d) => acc + d.requests, 0),
    errors: p.days.reduce((acc, d) => acc + d.errors, 0),
  })),
);

// Per-day hover: one hit column per date inside each row, tooltip with the
// raw numbers of that provider's day.
const hovered = ref<{ row: number; day: number } | null>(null);
</script>

<template>
  <div
    v-if="loading"
    class="glass-card rounded-2xl p-6 flex justify-center py-16"
  >
    <Spinner />
  </div>

  <div v-else-if="failed || !hasData" class="glass-card rounded-2xl">
    <EmptyState
      :title="
        failed ? t('chat.dashboard.loadFailed') : t('chat.stats.usage.empty')
      "
      :icon="BarChart3"
    />
  </div>

  <div v-else class="glass-card rounded-2xl p-5 space-y-4">
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {{
        t('chat.dashboard.proto.totals', {
          tokens: fmt.format(totals.tokens),
          requests: totals.requests,
          errors: totals.errors,
        })
      }}
    </p>

    <div class="space-y-1">
      <!-- Column headers. -->
      <div
        class="flex items-center gap-3 text-xxs text-slate-400 dark:text-slate-500"
      >
        <span class="w-14 shrink-0"></span>
        <span class="flex-1"></span>
        <span class="w-14 text-right shrink-0">{{
          t('chat.dashboard.proto.colTokens')
        }}</span>
        <span class="w-10 text-right shrink-0">{{
          t('chat.dashboard.proto.colRequests')
        }}</span>
        <span class="w-10 text-right shrink-0">{{
          t('chat.dashboard.proto.colErrors')
        }}</span>
      </div>

      <div
        v-for="(row, ri) in rows"
        :key="row.name"
        class="flex items-center gap-3 py-1.5 border-t border-slate-200/50 dark:border-white/5"
      >
        <span
          class="w-14 shrink-0 text-xs font-medium text-slate-700 dark:text-slate-300 truncate"
        >
          {{ row.name }}
        </span>

        <div class="relative flex-1 h-8">
          <svg
            :viewBox="`0 0 ${W} ${H}`"
            preserveAspectRatio="none"
            class="absolute inset-0 w-full h-full"
            :class="row.colorClass"
            aria-hidden="true"
          >
            <!-- Error bars behind the curves (shared scale across rows). -->
            <rect
              v-for="(bar, bi) in row.errorBars"
              :key="`bar-${bi}`"
              :x="bar.x"
              :y="H - PAD_Y - bar.height"
              :width="BAR_WIDTH"
              :height="bar.height"
              class="fill-red-500/25 dark:fill-red-400/25"
            />
            <!-- Tokens: dashed, the row's own scale. -->
            <path
              :d="row.tokensPath"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-dasharray="4 3"
              vector-effect="non-scaling-stroke"
              stroke-linecap="round"
              stroke-linejoin="round"
              opacity="0.65"
            />
            <!-- Requests: solid, the row's own scale. -->
            <path
              :d="row.requestsPath"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          <!-- Hover layer: one hit column per day. -->
          <div class="absolute inset-0 flex" aria-hidden="true">
            <div
              v-for="(d, di) in providers[ri].days"
              :key="di"
              class="flex-1"
              @mouseenter="hovered = { row: ri, day: di }"
              @mouseleave="hovered = null"
            ></div>
          </div>

          <!-- Day tooltip with the raw numbers. -->
          <div
            v-if="hovered?.row === ri"
            class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded-lg bg-white dark:bg-dark-800 border border-slate-200 dark:border-white/10 shadow-lg text-xxs whitespace-nowrap z-10 pointer-events-none"
          >
            <span class="text-slate-500 dark:text-slate-400">
              {{ row.name }} · {{ dayLabel(hovered.day) }}
            </span>
            <span class="font-semibold text-slate-900 dark:text-white ml-1.5">
              {{
                t('chat.dashboard.proto.tooltipLine', {
                  requests: providers[ri].days[hovered.day].requests,
                  tokens: fmt.format(providers[ri].days[hovered.day].tokens),
                  errors: providers[ri].days[hovered.day].errors,
                })
              }}
            </span>
          </div>
        </div>

        <span
          class="w-14 text-right shrink-0 text-xs font-semibold text-slate-900 dark:text-white"
        >
          {{ fmt.format(row.tokens) }}
        </span>
        <span
          class="w-10 text-right shrink-0 text-xs text-slate-600 dark:text-slate-300"
        >
          {{ row.requests }}
        </span>
        <span class="w-10 shrink-0 flex justify-end">
          <Badge v-if="row.errors > 0" tone="danger">
            {{ row.errors }}
          </Badge>
          <span v-else class="text-xs text-slate-400 dark:text-slate-500"
            >—</span
          >
        </span>
      </div>
    </div>

    <!-- Mark legend + axis ends. -->
    <div
      class="flex justify-between items-center text-xxs text-slate-400 dark:text-slate-500"
      aria-hidden="true"
    >
      <span>{{ dayLabel(0) }}</span>
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1.5">
          <svg
            viewBox="0 0 20 4"
            class="w-5 h-1 text-slate-500 dark:text-slate-400"
          >
            <line
              x1="0"
              y1="2"
              x2="20"
              y2="2"
              stroke="currentColor"
              stroke-width="2"
            />
          </svg>
          {{ t('chat.dashboard.proto.markRequests') }}
        </span>
        <span class="flex items-center gap-1.5">
          <svg
            viewBox="0 0 20 4"
            class="w-5 h-1 text-slate-500 dark:text-slate-400"
          >
            <line
              x1="0"
              y1="2"
              x2="20"
              y2="2"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray="4 3"
            />
          </svg>
          {{ t('chat.dashboard.proto.markTokens') }}
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="w-2 h-2.5 rounded-sm bg-red-500/25 dark:bg-red-400/25"
          ></span>
          {{ t('chat.dashboard.proto.markErrors') }}
        </span>
      </div>
      <span>{{ dayLabel(dates.length - 1) }}</span>
    </div>
  </div>
</template>
