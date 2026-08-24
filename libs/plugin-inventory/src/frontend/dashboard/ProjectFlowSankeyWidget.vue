<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { GitFork } from '@lucide/vue';
import {
  apiJson,
  EmptyState,
  Select,
  Spinner,
} from '@makekeeper/frontend-core';

// Dashboard panel (full-width): a classic 4-column Sankey of stock flows over
// a selectable period — suppliers & adjustments → warehouse → projects (and
// write-offs) → per-project outcomes (used / still reserved / returned).
// "Returned to stock" is a sink, never an edge back into the warehouse, so
// the diagram stays acyclic. Real data from the stats graph API
// (GET /api/stats/graph, ticket #56 §4.4); the accounting rules live next to
// `aggregateProjectFlows` on the backend (the inventory graph provider).
interface ProjectFlowRow {
  id: string;
  title: string | null;
  drawn: number;
  used: number;
  returned: number;
  stillReserved: number;
}

interface ProjectFlows {
  days: number;
  currentStock: number;
  suppliers: { id: string | null; name: string | null; units: number }[];
  adjustmentsIn: number;
  projects: ProjectFlowRow[];
  others: {
    count: number;
    drawn: number;
    used: number;
    returned: number;
    stillReserved: number;
  } | null;
  writeOffs: number;
}

const PERIODS = [7, 30, 90, 365];
const DEFAULT_DAYS = 30;

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const failed = ref(false);
const flows = ref<ProjectFlows | null>(null);

const fmt = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }),
);

// Period is a filter → it lives in route.query (§5.3), not a local ref.
const days = computed<number>({
  get: () => {
    const raw = route.query.flowDays;
    const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10);
    return PERIODS.includes(parsed) ? parsed : DEFAULT_DAYS;
  },
  set: (value) => {
    router.replace({
      query: {
        ...route.query,
        flowDays: value === DEFAULT_DAYS ? undefined : String(value),
      },
    });
  },
});

const periodOptions = computed(() =>
  PERIODS.map((n) => ({
    value: n,
    label: t('inventory.dashboard.flows.period', { n }),
  })),
);

const fetchFlows = async (): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    flows.value = await apiJson<ProjectFlows>(
      `/api/stats/graph?key=inventory.projectFlows&days=${days.value}`,
    );
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(fetchFlows);
watch(days, fetchFlows);

// ── Graph model ─────────────────────────────────────────────────────────
// Fixed (never cycled) hue assignment from the validated categorical set;
// neutrals for aggregates. Identity is never color-alone: every node carries
// a direct label, every ribbon a tooltip.
// CVD-validated adjacency order (indigo↔amber↔blue↔purple↔emerald all pass
// with ΔE ≥ 12; blue next to indigo does NOT — keep amber between them).
const PROJECT_COLORS = [
  'text-indigo-500',
  'text-amber-500 dark:text-amber-600',
  'text-brand-500',
  'text-purple-700 dark:text-purple-600',
  'text-emerald-600',
] as const;
const SUPPLIER_COLORS = [
  'text-indigo-500',
  'text-amber-500 dark:text-amber-600',
  'text-brand-500',
] as const;
const NEUTRAL = 'text-slate-400 dark:text-slate-500';
const OUTCOME_META = [
  {
    key: 'used',
    labelKey: 'inventory.dashboard.flows.used',
    colorClass: 'text-purple-700 dark:text-purple-600',
  },
  {
    key: 'stillReserved',
    labelKey: 'inventory.dashboard.flows.stillReserved',
    colorClass: 'text-amber-500 dark:text-amber-600',
  },
  {
    key: 'returned',
    labelKey: 'inventory.dashboard.flows.returned',
    colorClass: 'text-emerald-600',
  },
] as const;

type OutcomeKey = (typeof OUTCOME_META)[number]['key'];

interface FlowNode {
  key: string;
  label: string;
  value: number;
  colorClass: string;
  link?: string;
  sub?: string;
  // Per-project outcome split (C3 nodes only) — drives the C3→C4 ribbons.
  outcomes?: Record<OutcomeKey, number>;
}

interface Columns {
  sources: FlowNode[];
  warehouse: FlowNode;
  projects: FlowNode[];
  outcomes: FlowNode[];
}

// The warehouse→project ribbon carries what the project DREW in the period
// (its node height may be larger when outcomes exceed the window's draw).
const drawnOf = (f: ProjectFlows, node: FlowNode): number => {
  if (node.key === 'prj-others') return f.others?.drawn ?? 0;
  const id = node.key.replace(/^prj-/, '');
  return f.projects.find((p) => p.id === id)?.drawn ?? 0;
};

const columnsModel = computed<Columns | null>(() => {
  const f = flows.value;
  if (!f) return null;

  const sources: FlowNode[] = [];
  f.suppliers.forEach((s, i) => {
    if (s.units <= 0) return;
    sources.push({
      key: `src-${s.id ?? 'other'}`,
      label: s.name ?? t('inventory.dashboard.flows.noSupplier'),
      value: s.units,
      colorClass: s.id ? (SUPPLIER_COLORS[i] ?? NEUTRAL) : NEUTRAL,
    });
  });
  if (f.adjustmentsIn > 0) {
    sources.push({
      key: 'src-adjust',
      label: t('inventory.dashboard.flows.adjustmentsIn'),
      value: f.adjustmentsIn,
      colorClass: 'text-emerald-600',
    });
  }

  const projectNode = (row: ProjectFlowRow, i: number): FlowNode => ({
    key: `prj-${row.id}`,
    label: row.title ?? t('inventory.dashboard.flows.deletedProject'),
    value: Math.max(row.drawn, row.used + row.returned + row.stillReserved),
    colorClass: PROJECT_COLORS[i] ?? NEUTRAL,
    link: `/projects/${row.id}`,
    outcomes: {
      used: row.used,
      stillReserved: row.stillReserved,
      returned: row.returned,
    },
  });

  const projects: FlowNode[] = f.projects.map(projectNode);
  if (f.others) {
    projects.push({
      key: 'prj-others',
      label: t('inventory.dashboard.flows.otherProjects', {
        count: f.others.count,
      }),
      value: Math.max(
        f.others.drawn,
        f.others.used + f.others.returned + f.others.stillReserved,
      ),
      colorClass: NEUTRAL,
      outcomes: {
        used: f.others.used,
        stillReserved: f.others.stillReserved,
        returned: f.others.returned,
      },
    });
  }
  if (f.writeOffs > 0) {
    projects.push({
      key: 'prj-writeoffs',
      label: t('inventory.dashboard.flows.writeOffs'),
      value: f.writeOffs,
      colorClass: 'text-slate-500 dark:text-slate-400',
    });
  }

  const outcomes: FlowNode[] = OUTCOME_META.flatMap((meta) => {
    const value = projects.reduce(
      (acc, p) => acc + (p.outcomes?.[meta.key] ?? 0),
      0,
    );
    return value > 0
      ? [
          {
            key: `out-${meta.key}`,
            label: t(meta.labelKey),
            value,
            colorClass: meta.colorClass,
          },
        ]
      : [];
  });

  const inSum = sources.reduce((acc, n) => acc + n.value, 0);
  const outSum = projects.reduce(
    (acc, p) =>
      acc +
      (p.key === 'prj-writeoffs' ? p.value : p.outcomes ? drawnOf(f, p) : 0),
    0,
  );
  const warehouse: FlowNode = {
    key: 'warehouse',
    label: t('inventory.dashboard.flows.warehouse'),
    value: Math.max(inSum, outSum),
    colorClass: NEUTRAL,
    sub: t('inventory.dashboard.flows.stockNow', {
      n: fmt.value.format(f.currentStock),
    }),
  };

  if (inSum <= 0 && outSum <= 0 && outcomes.length === 0) return null;
  return { sources, warehouse, projects, outcomes };
});

// ── Layout: viewBox 0..100 × 0..100, labels as HTML overlay ─────────────
const PAD_Y = 4;
const GAP = 3;
const NW = 1.6;
const COL_X = [0, 33, 66, 100 - NW] as const;

interface PlacedNode extends FlowNode {
  x: number;
  y: number;
  h: number;
  inCursor: number;
  outCursor: number;
}

interface PlacedLink {
  id: string;
  path: string;
  colorClass: string;
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
  value: number;
}

interface Layout {
  nodes: PlacedNode[];
  links: PlacedLink[];
}

const layout = computed<Layout | null>(() => {
  const cols = columnsModel.value;
  if (!cols) return null;
  const columnLists = [
    cols.sources,
    [cols.warehouse],
    cols.projects,
    cols.outcomes,
  ];

  // One shared unit→height scale across every column.
  let scale = Number.POSITIVE_INFINITY;
  for (const list of columnLists) {
    const sum = list.reduce((acc, n) => acc + n.value, 0);
    if (sum <= 0) continue;
    const usable = 100 - PAD_Y * 2 - GAP * Math.max(0, list.length - 1);
    scale = Math.min(scale, usable / sum);
  }
  if (!Number.isFinite(scale)) return null;

  const nodes: PlacedNode[] = [];
  const byKey = new Map<string, PlacedNode>();
  columnLists.forEach((list, ci) => {
    const totalH =
      list.reduce((acc, n) => acc + n.value * scale, 0) +
      GAP * Math.max(0, list.length - 1);
    let y = PAD_Y + (100 - PAD_Y * 2 - totalH) / 2;
    for (const n of list) {
      const h = n.value * scale;
      const placed: PlacedNode = {
        ...n,
        x: COL_X[ci],
        y,
        h,
        inCursor: y,
        outCursor: y,
      };
      nodes.push(placed);
      byKey.set(n.key, placed);
      y += h + GAP;
    }
  });

  const band = (
    from: PlacedNode,
    to: PlacedNode,
    value: number,
    colorClass: string,
  ): PlacedLink => {
    const th = value * scale;
    const x0 = from.x + NW;
    const x1 = to.x;
    const mx = (x0 + x1) / 2;
    const ta = from.outCursor;
    const tb = to.inCursor;
    from.outCursor += th;
    to.inCursor += th;
    const path =
      `M ${x0} ${ta} C ${mx} ${ta}, ${mx} ${tb}, ${x1} ${tb}` +
      ` L ${x1} ${tb + th} C ${mx} ${tb + th}, ${mx} ${ta + th}, ${x0} ${ta + th} Z`;
    return {
      id: `${from.key}→${to.key}`,
      path,
      colorClass,
      fromKey: from.key,
      toKey: to.key,
      fromLabel: from.label,
      toLabel: to.label,
      value,
    };
  };

  const links: PlacedLink[] = [];
  const warehouse = byKey.get('warehouse');
  const f = flows.value;
  if (!warehouse || !f) return null;

  for (const src of cols.sources) {
    const from = byKey.get(src.key);
    if (from && src.value > 0)
      links.push(band(from, warehouse, src.value, src.colorClass));
  }
  for (const prj of cols.projects) {
    const to = byKey.get(prj.key);
    if (!to) continue;
    const value = prj.key === 'prj-writeoffs' ? prj.value : drawnOf(f, prj);
    if (value > 0) links.push(band(warehouse, to, value, prj.colorClass));
  }
  for (const prj of cols.projects) {
    const from = byKey.get(prj.key);
    if (!from || !prj.outcomes) continue;
    for (const meta of OUTCOME_META) {
      const value = prj.outcomes[meta.key];
      const to = byKey.get(`out-${meta.key}`);
      if (to && value > 0) links.push(band(from, to, value, meta.colorClass));
    }
  }

  return { nodes, links };
});

// ── Hover: highlight the hovered ribbon/node, dim unrelated ribbons ─────
const hoveredKey = ref<string | null>(null);
const tooltip = ref<{
  x: number;
  y: number;
  text: string;
  value: number;
} | null>(null);

const isLinkRelated = (link: PlacedLink): boolean => {
  const key = hoveredKey.value;
  if (!key) return true;
  return link.id === key || link.fromKey === key || link.toKey === key;
};

const onLinkEnter = (link: PlacedLink, evt: MouseEvent): void => {
  hoveredKey.value = link.id;
  tooltip.value = {
    x: evt.clientX,
    y: evt.clientY,
    text: t('inventory.dashboard.flows.flowTooltip', {
      from: link.fromLabel,
      to: link.toLabel,
    }),
    value: link.value,
  };
};

const onNodeEnter = (node: PlacedNode, evt: MouseEvent): void => {
  hoveredKey.value = node.key;
  tooltip.value = {
    x: evt.clientX,
    y: evt.clientY,
    text: node.label,
    value: node.value,
  };
};

const onHoverMove = (evt: MouseEvent): void => {
  if (tooltip.value) {
    tooltip.value = { ...tooltip.value, x: evt.clientX, y: evt.clientY };
  }
};

const onHoverLeave = (): void => {
  hoveredKey.value = null;
  tooltip.value = null;
};

// Label visibility by node height (viewBox units of a ~320px-tall chart).
const showValue = (node: PlacedNode): boolean => node.h >= 6;
const showLabel = (node: PlacedNode): boolean => node.h >= 3;
</script>

<template>
  <div
    v-if="loading"
    class="glass-card rounded-2xl p-6 flex justify-center py-16"
  >
    <Spinner />
  </div>

  <div
    v-else-if="!failed && layout"
    class="glass-card rounded-2xl p-5 space-y-4"
  >
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ t('inventory.dashboard.flows.hint', { days }) }}
      </p>
      <label
        class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
      >
        {{ t('inventory.dashboard.flows.periodLabel') }}
        <Select
          v-model="days"
          :options="periodOptions"
          trigger-class="!py-1.5 !text-xs w-44"
        />
      </label>
    </div>

    <!-- Column captions. -->
    <div
      class="flex justify-between text-xxs text-slate-400 dark:text-slate-500"
      aria-hidden="true"
    >
      <span>{{ t('inventory.dashboard.flows.col.sources') }}</span>
      <span>{{ t('inventory.dashboard.flows.col.warehouse') }}</span>
      <span>{{ t('inventory.dashboard.flows.col.projects') }}</span>
      <span>{{ t('inventory.dashboard.flows.col.outcome') }}</span>
    </div>

    <div
      class="relative h-80"
      role="img"
      :aria-label="t('inventory.dashboard.flows.aria', { days })"
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        class="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        <path
          v-for="link in layout.links"
          :key="link.id"
          :d="link.path"
          class="fill-current transition-opacity"
          :class="[
            link.colorClass,
            hoveredKey === null
              ? 'opacity-40'
              : isLinkRelated(link)
                ? 'opacity-70'
                : 'opacity-15',
          ]"
          @mouseenter="onLinkEnter(link, $event)"
          @mousemove="onHoverMove"
          @mouseleave="onHoverLeave"
        />
        <rect
          v-for="node in layout.nodes"
          :key="node.key"
          :x="node.x"
          :y="node.y"
          :width="NW"
          :height="Math.max(node.h, 0.8)"
          rx="0.5"
          class="fill-current opacity-80"
          :class="node.colorClass"
          @mouseenter="onNodeEnter(node, $event)"
          @mousemove="onHoverMove"
          @mouseleave="onHoverLeave"
        />
      </svg>

      <!-- Labels: HTML overlay (never distorts with the stretched SVG). -->
      <template v-for="node in layout.nodes" :key="`label-${node.key}`">
        <div
          v-if="showLabel(node)"
          class="absolute -translate-y-1/2 text-xxs leading-tight px-1 py-0.5 rounded bg-white/75 dark:bg-dark-900/75 pointer-events-none max-w-56"
          :class="node.x > 90 ? 'right-0 text-right' : ''"
          :style="{
            top: `${node.y + node.h / 2}%`,
            ...(node.x > 90 ? {} : { left: `calc(${node.x + NW}% + 4px)` }),
          }"
        >
          <span class="flex items-center gap-1 flex-wrap pointer-events-auto">
            <span
              class="w-2 h-2 rounded-sm bg-current shrink-0"
              :class="node.colorClass"
            ></span>
            <RouterLink
              v-if="node.link"
              :to="node.link"
              class="text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 truncate max-w-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-sm"
            >
              {{ node.label }}
            </RouterLink>
            <span
              v-else
              class="text-slate-700 dark:text-slate-200 truncate max-w-40"
            >
              {{ node.label }}
            </span>
            <span
              v-if="showValue(node)"
              class="font-semibold text-slate-900 dark:text-white"
            >
              {{ fmt.format(node.value) }}
            </span>
          </span>
          <span
            v-if="node.sub && showValue(node)"
            class="block text-slate-500 dark:text-slate-400"
          >
            {{ node.sub }}
          </span>
        </div>
      </template>
    </div>

    <!-- Outcome legend. -->
    <div
      class="flex items-center justify-end gap-3 text-xxs text-slate-400 dark:text-slate-500"
      aria-hidden="true"
    >
      <span
        v-for="meta in OUTCOME_META"
        :key="meta.key"
        class="flex items-center gap-1.5"
      >
        <span
          class="w-2 h-2 rounded-sm bg-current"
          :class="meta.colorClass"
        ></span>
        {{ t(meta.labelKey) }}
      </span>
    </div>

    <Teleport to="body">
      <div
        v-if="tooltip"
        class="fixed -translate-x-1/2 -translate-y-full px-2 py-1 rounded-lg bg-white dark:bg-dark-800 border border-slate-200 dark:border-white/10 shadow-lg text-xxs whitespace-nowrap z-50 pointer-events-none"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y - 10}px` }"
      >
        <span class="text-slate-500 dark:text-slate-400">{{
          tooltip.text
        }}</span>
        <span class="font-semibold text-slate-900 dark:text-white ml-1.5">{{
          fmt.format(tooltip.value)
        }}</span>
      </div>
    </Teleport>
  </div>

  <div v-else-if="!failed" class="glass-card rounded-2xl p-5 space-y-4">
    <div class="flex items-center justify-end">
      <label
        class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
      >
        {{ t('inventory.dashboard.flows.periodLabel') }}
        <Select
          v-model="days"
          :options="periodOptions"
          trigger-class="!py-1.5 !text-xs w-44"
        />
      </label>
    </div>
    <EmptyState
      :title="t('inventory.dashboard.flows.empty')"
      :description="t('inventory.dashboard.flows.emptyHint')"
      :icon="GitFork"
    />
  </div>

  <div v-else class="glass-card rounded-2xl">
    <EmptyState :title="t('inventory.dashboard.loadFailed')" :icon="GitFork" />
  </div>
</template>
