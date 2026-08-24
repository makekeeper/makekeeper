<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { BadgeTone } from '@makekeeper/frontend-core';
import {
  Badge,
  Button,
  EmptyState,
  Select,
  Switch,
  TimePicker,
  resolveObjectRefRoute,
  useConfirm,
} from '@makekeeper/frontend-core';
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  CircleAlert,
  Info,
  Sparkles,
} from '@lucide/vue';
import type {
  UiAction,
  UiNode,
  UiPaging,
  UiTableColumn,
  UiTableNode,
  UiText,
  UiTone,
} from '@makekeeper/plugin-contract';

type UiTableRow = UiTableNode['rows'][number];
import { externalI18nKey } from '../external-types';

// Renders one level of an external plugin's declarative tree with the app's
// own primitives (#134). This is the whole reason external plugins ship no
// frontend code: the design system, dark/light pairing, focus rings, i18n and
// ORef linking are OURS, so a third-party screen cannot drift from them.
//
// Text always arrives as an i18n reference resolved inside the plugin's own
// `ext.<pluginId>` namespace — a raw literal is impossible by contract (the
// sanitizer drops nodes whose text is not a `{ key }`), which is what keeps
// §5.5 true for code we never review.

const props = defineProps<{
  pluginId: string;
  nodes: UiNode[];
  // Form state is owned by the screen host (one bag per rendered screen) so a
  // re-render from an action response does not lose in-progress input.
  formValues: Record<string, string | number | boolean>;
  // An action is in flight: every control that would start another one is
  // disabled and the submit shows it is working. A render round trip runs to a
  // whole container, so "nothing happened yet" is a state the user sees.
  busy?: boolean;
}>();

const emit = defineEmits<{
  (
    e: 'action',
    action: UiAction,
    form?: Record<string, string | number | boolean>,
  ): void;
  (e: 'field', name: string, value: string | number | boolean): void;
  // A field that asked for a re-render changed (contract 1.2).
  (e: 'reload'): void;
  // Ask the host to re-render the screen with these params merged in — how a
  // plugin-paged table or list turns its page (contract 1.8).
  (e: 'params', params: Record<string, string>): void;
}>();

// Field changes are reported first and the reload requested after, so the
// screen host already holds the new value when it asks for the redraw.
//
// Discrete fields (a select, a switch) redraw the moment they change: that IS
// the choice being made. Text fields report every keystroke but only ask for a
// redraw when the value is committed — re-rendering per character would fight
// the person typing.
const onField = (
  field: { name: string; reloadOnChange?: boolean },
  value: string | number | boolean,
  redraw = true,
): void => {
  emit('field', field.name, value);
  if (redraw && field.reloadOnChange) emit('reload');
};

const { t } = useI18n();
const confirm = useConfirm();

// A declared confirmation is HONOURED, not decorative. The contract has
// offered `confirm` on a button since 1.0 and the renderer ignored it, so a
// plugin that asked for a gate got none and its destructive action ran on the
// first click. The dialog is the app's own (§5.3) — never the browser's.
const run = async (
  action: UiAction,
  form?: Record<string, string | number | boolean>,
  confirmText?: UiText,
): Promise<void> => {
  if (confirmText) {
    const ok = await confirm({ message: text(confirmText), tone: 'danger' });
    if (!ok) return;
  }
  emit('action', action, form);
};

const text = (value: UiText | string): string =>
  typeof value === 'string'
    ? value
    : t(externalI18nKey(props.pluginId, value.key), value.params ?? {});

// The contract's tones map to the Badge's, and the Badge's own type is what
// this returns — `emerald`/`amber`/`red` are the colours behind those tones,
// not tone names, and a badge given one looked up nothing and rendered with no
// colour at all.
const badgeTone = (tone: UiTone | undefined): BadgeTone => {
  const map: Record<UiTone, BadgeTone> = {
    neutral: 'neutral',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    brand: 'brand',
  };
  return map[tone ?? 'neutral'];
};

const calloutClass = (tone: UiTone | undefined): string => {
  const map: Record<UiTone, string> = {
    neutral:
      'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    warning:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    danger:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    brand:
      'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300',
  };
  return map[tone ?? 'neutral'];
};

// Status is never carried by colour alone: a tone brings both an icon and the
// live-region role that makes the message announced rather than merely seen.
const calloutIcon = (tone: UiTone | undefined) => {
  const map = {
    neutral: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: CircleAlert,
    brand: Sparkles,
  } as const;
  return map[tone ?? 'neutral'];
};

const calloutRole = (tone: UiTone | undefined): 'alert' | 'status' =>
  tone === 'danger' || tone === 'warning' ? 'alert' : 'status';

// An ORef renders as an in-app link when the owning plugin maps it to a route;
// otherwise it degrades to plain text (never a bare mk:// string, §5.9).
const refRoute = (ref: string | undefined) =>
  ref ? resolveObjectRefRoute(ref) : null;

const buttonVariant = (
  variant: string | undefined,
): 'primary' | 'secondary' | 'danger' | 'ghost' =>
  variant === 'secondary' || variant === 'danger' || variant === 'ghost'
    ? variant
    : 'primary';

const fieldValue = (
  name: string,
  fallback: unknown,
): string | number | boolean =>
  props.formValues[name] ??
  (typeof fallback === 'string' ||
  typeof fallback === 'number' ||
  typeof fallback === 'boolean'
    ? fallback
    : '');

const stringValue = (name: string, fallback: unknown): string =>
  String(fieldValue(name, fallback) ?? '');

const boolValue = (name: string, fallback: unknown): boolean =>
  fieldValue(name, fallback) === true;

const nodeKey = (index: number): string => `n${index}`;

// Filtering and paging a table the plugin handed over whole (contract 1.7).
// Client-side on purpose: instant, one implementation, and no round trip per
// keystroke. State is keyed by the node's position, which is stable for as
// long as the tree is.
const tableQuery = ref<Record<string, string>>({});
const tablePage = ref<Record<string, number>>({});

const rowText = (row: UiTableRow, columns: UiTableColumn[]): string =>
  columns
    .map((col) => {
      const cell = row.cells[col.key];
      if (!cell) return '';
      const badge = cell.badge ? text(cell.badge.text) : '';
      const value = cell.text === undefined ? '' : text(cell.text);
      return `${value} ${badge}`;
    })
    .join(' ')
    .toLowerCase();

const visibleRows = (node: UiTableNode, key: string): UiTableRow[] => {
  const needle = (tableQuery.value[key] ?? '').trim().toLowerCase();
  return needle
    ? node.rows.filter((row) => rowText(row, node.columns).includes(needle))
    : node.rows;
};

const pageOf = (key: string): number => tablePage.value[key] ?? 0;

const pageCount = (node: UiTableNode, key: string): number =>
  node.pageSize && node.pageSize > 0
    ? Math.max(1, Math.ceil(visibleRows(node, key).length / node.pageSize))
    : 1;

const pagedRows = (node: UiTableNode, key: string): UiTableRow[] => {
  const rows = sortRows(node, key, visibleRows(node, key));
  if (!node.pageSize || node.pageSize <= 0) return rows;
  const page = Math.min(pageOf(key), pageCount(node, key) - 1);
  return rows.slice(page * node.pageSize, (page + 1) * node.pageSize);
};

// A plugin-paged node: the CORE only draws the controls, the plugin decides
// what page 3 contains. `total` is optional on purpose — counting ten million
// rows to render twenty is the cost this mode exists to avoid.
const serverPage = (paging: UiPaging): number => paging.page;

const serverPages = (paging: UiPaging): number | null =>
  typeof paging.total === 'number' && paging.pageSize > 0
    ? Math.max(1, Math.ceil(paging.total / paging.pageSize))
    : null;

const canGoBack = (paging: UiPaging): boolean => paging.page > 0;

const canGoForward = (paging: UiPaging): boolean => {
  const pages = serverPages(paging);
  return pages === null ? paging.hasMore === true : paging.page < pages - 1;
};

const turnServerPage = (paging: UiPaging, delta: number): void => {
  const next = Math.max(0, paging.page + delta);
  emit('params', { [paging.pageParam ?? 'page']: String(next) });
};

// Sorting, in whichever mode the table is in.
//
// The rule is the same one paging follows: whoever holds the rows sorts them.
// A core-paged table has everything and sorts locally; a plugin-paged table
// gets the sort as render params, because sorting the twenty rows it happens
// to be showing would sort the wrong thing.
const tableSort = ref<
  Record<string, { key: string; direction: 'asc' | 'desc' }>
>({});

const sortOf = (
  node: UiTableNode,
  key: string,
): { key: string; direction: 'asc' | 'desc' } | null =>
  node.paging?.sort ?? tableSort.value[key] ?? null;

// Numbers compare as numbers when both sides are numbers — a rate table sorted
// as text puts 9 after 10.
const compareCells = (a: string, b: string): number => {
  const left = Number(a);
  const right = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(left) && Number.isFinite(right)) {
    return left - right;
  }
  return a.localeCompare(b);
};

const cellText = (row: UiTableRow, columnKey: string): string => {
  const cell = row.cells[columnKey];
  if (!cell) return '';
  if (cell.text !== undefined) return text(cell.text);
  return cell.badge ? text(cell.badge.text) : '';
};

const sortRows = (
  node: UiTableNode,
  key: string,
  rows: UiTableRow[],
): UiTableRow[] => {
  // A plugin-paged table arrives sorted; re-sorting the page would be a lie.
  if (node.paging) return rows;
  const sort = tableSort.value[key];
  if (!sort) return rows;
  const factor = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort(
    (a, b) =>
      factor * compareCells(cellText(a, sort.key), cellText(b, sort.key)),
  );
};

const toggleSort = (
  node: UiTableNode,
  key: string,
  columnKey: string,
): void => {
  const current = sortOf(node, key);
  const direction: 'asc' | 'desc' =
    current?.key === columnKey && current.direction === 'asc' ? 'desc' : 'asc';
  if (node.paging) {
    // Back to the first page: staying on page seven of a differently ordered
    // result shows rows nobody asked for.
    emit('params', {
      [node.paging.sortParam ?? 'sort']: columnKey,
      [node.paging.directionParam ?? 'direction']: direction,
      [node.paging.pageParam ?? 'page']: '0',
    });
    return;
  }
  tableSort.value = {
    ...tableSort.value,
    [key]: { key: columnKey, direction },
  };
  tablePage.value = { ...tablePage.value, [key]: 0 };
};

const ariaSort = (
  node: UiTableNode,
  key: string,
  columnKey: string,
): 'ascending' | 'descending' | 'none' | undefined => {
  const sort = sortOf(node, key);
  if (!sort || sort.key !== columnKey) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
};

const setQuery = (key: string, value: string): void => {
  tableQuery.value = { ...tableQuery.value, [key]: value };
  // A narrowed list starts at its beginning; staying on page 7 of a result
  // that now has two pages shows nothing at all.
  tablePage.value = { ...tablePage.value, [key]: 0 };
};

const turnPage = (key: string, node: UiTableNode, delta: number): void => {
  const next = Math.min(
    Math.max(0, pageOf(key) + delta),
    pageCount(node, key) - 1,
  );
  tablePage.value = { ...tablePage.value, [key]: next };
};

const hasNodes = computed(() => props.nodes.length > 0);
</script>

<template>
  <!-- A screen that returned nothing is still a screen the user navigated to:
       say so rather than leaving a blank page. -->
  <EmptyState
    v-if="!hasNodes"
    :title="t('external.render.empty')"
    :icon="Info"
  />

  <div v-else class="flex flex-col gap-4">
    <template v-for="(node, index) in nodes" :key="nodeKey(index)">
      <!-- text -->
      <p
        v-if="node.type === 'text'"
        :class="[
          node.variant === 'heading'
            ? 'text-base font-semibold text-slate-900 dark:text-white'
            : node.variant === 'muted'
              ? 'text-sm text-slate-500 dark:text-slate-400'
              : 'text-sm text-slate-700 dark:text-slate-300',
        ]"
      >
        {{ text(node.text) }}
      </p>

      <!-- badge -->
      <div v-else-if="node.type === 'badge'">
        <Badge :tone="badgeTone(node.tone)">
          {{ text(node.text) }}
        </Badge>
      </div>

      <!-- stat -->
      <div
        v-else-if="node.type === 'stat'"
        class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"
      >
        <p
          class="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
        >
          {{ text(node.label) }}
        </p>
        <p class="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
          {{ node.value }}
          <span
            v-if="node.unit"
            class="text-sm font-normal text-slate-500 dark:text-slate-400"
          >
            {{ text(node.unit) }}
          </span>
        </p>
      </div>

      <!-- callout -->
      <div
        v-else-if="node.type === 'callout'"
        class="flex items-start gap-2 rounded-xl border p-3 text-sm"
        :class="calloutClass(node.tone)"
        :role="calloutRole(node.tone)"
      >
        <component
          :is="calloutIcon(node.tone)"
          class="mt-0.5 h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        <p>{{ text(node.text) }}</p>
      </div>

      <!-- divider -->
      <hr
        v-else-if="node.type === 'divider'"
        class="border-slate-200 dark:border-white/10"
      />

      <!-- button -->
      <div v-else-if="node.type === 'button'">
        <!-- A button carries whatever is typed in the screen's form, exactly
             as a submit does. That is what lets a plugin offer "test this
             connection" next to the fields being tested, instead of demanding
             the settings be saved before they can be checked. Plugins that do
             not care simply ignore the payload. -->
        <Button
          :variant="buttonVariant(node.variant)"
          :loading="busy"
          @click="run(node.onClick, formValues, node.confirm)"
        >
          {{ text(node.label) }}
        </Button>
      </div>

      <!-- detail -->
      <dl
        v-else-if="node.type === 'detail'"
        class="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"
      >
        <div
          v-for="(row, rowIndex) in node.rows"
          :key="`r${rowIndex}`"
          class="flex flex-wrap items-baseline gap-2"
        >
          <dt
            class="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500"
          >
            {{ text(row.label) }}
          </dt>
          <dd class="text-sm text-slate-700 dark:text-slate-300">
            <RouterLink
              v-if="refRoute(row.ref)"
              :to="refRoute(row.ref)!"
              class="text-brand-600 hover:underline dark:text-brand-400"
            >
              {{ text(row.value) }}
            </RouterLink>
            <span v-else>{{ text(row.value) }}</span>
          </dd>
        </div>
      </dl>

      <!-- table -->
      <div v-else-if="node.type === 'table'" class="flex flex-col gap-2">
        <!-- Filter and pages are the CORE's (contract 1.7): the plugin hands
             over every row and the search is instant, with no round trip and
             no per-plugin reimplementation. -->
        <label v-if="node.filterable" class="flex flex-col gap-1">
          <span class="sr-only">{{ t('external.render.filter') }}</span>
          <input
            type="search"
            class="glass-input rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            :placeholder="t('external.render.filter')"
            :value="tableQuery[nodeKey(index)] ?? ''"
            @input="
              setQuery(
                nodeKey(index),
                ($event.target as HTMLInputElement).value,
              )
            "
          />
        </label>

        <div
          class="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5"
        >
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 dark:border-white/10">
                <th
                  v-for="col in node.columns"
                  :key="col.key"
                  class="px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
                  :class="col.align === 'right' ? 'text-right' : 'text-left'"
                  :aria-sort="
                    col.sortable
                      ? ariaSort(node, nodeKey(index), col.key)
                      : undefined
                  "
                >
                  <button
                    v-if="col.sortable"
                    type="button"
                    class="inline-flex items-center gap-1 rounded uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    :disabled="busy"
                    @click="toggleSort(node, nodeKey(index), col.key)"
                  >
                    {{ text(col.label) }}
                    <ArrowUp
                      v-if="sortOf(node, nodeKey(index))?.key === col.key"
                      class="h-3 w-3 transition-transform"
                      :class="
                        sortOf(node, nodeKey(index))?.direction === 'desc'
                          ? 'rotate-180'
                          : ''
                      "
                      aria-hidden="true"
                    />
                    <ArrowUpDown
                      v-else
                      class="h-3 w-3 opacity-40"
                      aria-hidden="true"
                    />
                  </button>
                  <template v-else>
                    {{ text(col.label) }}
                  </template>
                </th>
                <th
                  v-if="node.rows.some((row) => row.action)"
                  class="px-4 py-2"
                >
                  <span class="sr-only">{{
                    t('external.render.rowAction')
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in pagedRows(node, nodeKey(index))"
                :key="`tr${rowIndex}`"
                class="border-b border-slate-100 last:border-0 dark:border-white/5"
                :class="
                  row.onClick
                    ? 'cursor-pointer hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-white/5'
                    : ''
                "
                :role="row.onClick ? 'button' : undefined"
                :tabindex="row.onClick ? 0 : undefined"
                @click="row.onClick && emit('action', row.onClick)"
                @keydown.enter.prevent="
                  row.onClick && emit('action', row.onClick)
                "
                @keydown.space.prevent="
                  row.onClick && emit('action', row.onClick)
                "
              >
                <td
                  v-for="col in node.columns"
                  :key="col.key"
                  class="px-4 py-2 text-slate-700 dark:text-slate-300"
                  :class="col.align === 'right' ? 'text-right' : 'text-left'"
                >
                  <Badge
                    v-if="row.cells[col.key]?.badge"
                    :tone="badgeTone(row.cells[col.key]!.badge!.tone)"
                  >
                    {{ text(row.cells[col.key]!.badge!.text) }}
                  </Badge>
                  <RouterLink
                    v-else-if="refRoute(row.cells[col.key]?.ref)"
                    :to="refRoute(row.cells[col.key]?.ref)!"
                    class="text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {{ text(row.cells[col.key]?.text ?? '') }}
                  </RouterLink>
                  <span v-else>{{ text(row.cells[col.key]?.text ?? '') }}</span>
                </td>
                <td
                  v-if="node.rows.some((r) => r.action)"
                  class="px-4 py-2 text-right"
                >
                  <Button
                    v-if="row.action"
                    :variant="buttonVariant(row.action.variant)"
                    :disabled="busy"
                    size="sm"
                    @click.stop="
                      run(row.action.onClick, undefined, row.action.confirm)
                    "
                  >
                    {{ text(row.action.label) }}
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="visibleRows(node, nodeKey(index)).length === 0"
            class="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400"
          >
            {{
              tableQuery[nodeKey(index)]
                ? t('external.render.noMatches')
                : node.empty
                  ? text(node.empty)
                  : t('external.render.noRows')
            }}
          </p>
        </div>

        <!-- Plugin-side paging (contract 1.8): the buttons ask for another
             render rather than slicing rows the browser already holds. -->
        <div v-if="node.paging" class="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy || !canGoBack(node.paging)"
            @click="turnServerPage(node.paging, -1)"
          >
            {{ t('external.render.prev') }}
          </Button>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            {{
              serverPages(node.paging) === null
                ? t('external.render.pageOnly', {
                    page: serverPage(node.paging) + 1,
                  })
                : t('external.render.page', {
                    page: serverPage(node.paging) + 1,
                    pages: serverPages(node.paging),
                    total: node.paging.total,
                  })
            }}
          </span>
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy || !canGoForward(node.paging)"
            @click="turnServerPage(node.paging, 1)"
          >
            {{ t('external.render.next') }}
          </Button>
        </div>

        <div
          v-else-if="pageCount(node, nodeKey(index)) > 1"
          class="flex items-center justify-between gap-2"
        >
          <Button
            variant="secondary"
            size="sm"
            :disabled="pageOf(nodeKey(index)) === 0"
            @click="turnPage(nodeKey(index), node, -1)"
          >
            {{ t('external.render.prev') }}
          </Button>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            {{
              t('external.render.page', {
                page: pageOf(nodeKey(index)) + 1,
                pages: pageCount(node, nodeKey(index)),
                total: visibleRows(node, nodeKey(index)).length,
              })
            }}
          </span>
          <Button
            variant="secondary"
            size="sm"
            :disabled="
              pageOf(nodeKey(index)) >= pageCount(node, nodeKey(index)) - 1
            "
            @click="turnPage(nodeKey(index), node, 1)"
          >
            {{ t('external.render.next') }}
          </Button>
        </div>
      </div>

      <!-- list -->
      <ul
        v-else-if="node.type === 'list'"
        class="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-white/5 dark:border-white/10 dark:bg-white/5"
      >
        <li
          v-for="(item, itemIndex) in node.items"
          :key="`i${itemIndex}`"
          class="flex items-center gap-3 px-4 py-3"
          :class="
            item.onClick
              ? 'cursor-pointer hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-white/5'
              : ''
          "
          :role="item.onClick ? 'button' : undefined"
          :tabindex="item.onClick ? 0 : undefined"
          @click="item.onClick && emit('action', item.onClick)"
          @keydown.enter.prevent="item.onClick && emit('action', item.onClick)"
          @keydown.space.prevent="item.onClick && emit('action', item.onClick)"
        >
          <div class="min-w-0 flex-1">
            <RouterLink
              v-if="refRoute(item.ref)"
              :to="refRoute(item.ref)!"
              class="truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {{ text(item.title) }}
            </RouterLink>
            <p
              v-else
              class="truncate text-sm font-medium text-slate-900 dark:text-white"
            >
              {{ text(item.title) }}
            </p>
            <p
              v-if="item.subtitle"
              class="truncate text-xs text-slate-500 dark:text-slate-400"
            >
              {{ text(item.subtitle) }}
            </p>
          </div>
          <Badge v-if="item.badge" :tone="badgeTone(item.badge.tone)">
            {{ text(item.badge.text) }}
          </Badge>
          <!-- An action ON the row (contract 1.5). It stops the click from
               reaching the row, so "delete this" never doubles as "open
               this". -->
          <Button
            v-if="item.action"
            :variant="buttonVariant(item.action.variant)"
            :disabled="busy"
            size="sm"
            @click.stop="
              run(item.action.onClick, undefined, item.action.confirm)
            "
          >
            {{ text(item.action.label) }}
          </Button>
        </li>
        <li
          v-if="node.items.length === 0 && node.empty"
          class="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400"
        >
          {{ text(node.empty) }}
        </li>
      </ul>
      <div
        v-if="node.type === 'list' && node.paging"
        class="flex items-center justify-between gap-2"
      >
        <Button
          variant="secondary"
          size="sm"
          :disabled="busy || !canGoBack(node.paging)"
          @click="turnServerPage(node.paging, -1)"
        >
          {{ t('external.render.prev') }}
        </Button>
        <span class="text-xs text-slate-500 dark:text-slate-400">
          {{
            serverPages(node.paging) === null
              ? t('external.render.pageOnly', {
                  page: serverPage(node.paging) + 1,
                })
              : t('external.render.page', {
                  page: serverPage(node.paging) + 1,
                  pages: serverPages(node.paging),
                  total: node.paging.total,
                })
          }}
        </span>
        <Button
          variant="secondary"
          size="sm"
          :disabled="busy || !canGoForward(node.paging)"
          @click="turnServerPage(node.paging, 1)"
        >
          {{ t('external.render.next') }}
        </Button>
      </div>

      <!-- form -->
      <form
        v-else-if="node.type === 'form'"
        class="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-opacity sm:grid-cols-2 dark:border-white/10 dark:bg-white/5"
        :class="busy ? 'pointer-events-none opacity-60' : ''"
        :aria-busy="busy"
        @submit.prevent="emit('action', node.submit.onSubmit, formValues)"
      >
        <!-- Two columns on a wide screen, one on a narrow one. A field claims
             a row unless it asked to share (contract 1.3) — related short
             inputs (a URL and its token) read as one thing when they sit
             together. -->
        <div
          v-for="field in node.fields"
          :key="field.name"
          class="flex flex-col gap-1"
          :class="field.width === 'half' ? 'sm:col-span-1' : 'sm:col-span-2'"
        >
          <label
            :for="`${pluginId}-${field.name}`"
            class="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
          >
            {{ text(field.label) }}
          </label>

          <Switch
            v-if="field.type === 'switch'"
            :id="`${pluginId}-${field.name}`"
            :model-value="boolValue(field.name, field.value)"
            :aria-label="text(field.label)"
            :disabled="busy"
            @update:model-value="(v: boolean) => onField(field, v)"
          />
          <Select
            v-else-if="field.type === 'select'"
            :id="`${pluginId}-${field.name}`"
            :aria-label="text(field.label)"
            :aria-describedby="
              field.hintKey ? `${pluginId}-${field.name}-hint` : undefined
            "
            :model-value="stringValue(field.name, field.value)"
            :options="
              (field.options ?? []).map((o) => ({
                value: o.value,
                label: text(o.label),
              }))
            "
            :disabled="busy"
            @update:model-value="(v: string) => onField(field, v)"
          />
          <TimePicker
            v-else-if="field.type === 'time'"
            :id="`${pluginId}-${field.name}`"
            :aria-label="text(field.label)"
            :model-value="stringValue(field.name, field.value)"
            :disabled="busy"
            @update:model-value="(v: string) => onField(field, v)"
          />
          <textarea
            v-else-if="field.type === 'textarea'"
            :id="`${pluginId}-${field.name}`"
            :aria-describedby="
              field.hintKey ? `${pluginId}-${field.name}-hint` : undefined
            "
            class="glass-input min-h-24 rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            :value="stringValue(field.name, field.value)"
            :required="field.required"
            :placeholder="
              field.placeholderKey ? text({ key: field.placeholderKey }) : ''
            "
            @input="
              onField(
                field,
                ($event.target as HTMLTextAreaElement).value,
                false,
              )
            "
            @change="field.reloadOnChange && emit('reload')"
          />
          <!-- `autocomplete=off` on a password: a plugin's token is not a site
               login, and without this the browser offers to fill (and later to
               save) the user's own password into it. -->
          <input
            v-else
            :id="`${pluginId}-${field.name}`"
            :aria-describedby="
              field.hintKey ? `${pluginId}-${field.name}-hint` : undefined
            "
            class="glass-input rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            :type="
              field.type === 'number'
                ? 'number'
                : field.type === 'date'
                  ? 'date'
                  : field.type === 'time'
                    ? 'time'
                    : field.type === 'password'
                      ? 'password'
                      : 'text'
            "
            :value="stringValue(field.name, field.value)"
            :required="field.required"
            :placeholder="
              field.placeholderKey ? text({ key: field.placeholderKey }) : ''
            "
            :autocomplete="field.type === 'password' ? 'off' : undefined"
            @input="
              onField(field, ($event.target as HTMLInputElement).value, false)
            "
            @change="field.reloadOnChange && emit('reload')"
          />

          <!-- The field's own explanation, under the field it explains
               (contract 1.6), and tied to the control with aria-describedby so
               it is read out WITH it. Beside the form it read as orphan text
               belonging to nothing in particular. -->
          <p
            v-if="field.hintKey"
            :id="`${pluginId}-${field.name}-hint`"
            class="text-xxs text-slate-500 dark:text-slate-400"
          >
            {{ text({ key: field.hintKey }) }}
          </p>
        </div>
        <div class="sm:col-span-2">
          <Button type="submit" :loading="busy">
            {{ text(node.submit.label) }}
          </Button>
        </div>
      </form>

      <!-- section (recursive) -->
      <section v-else-if="node.type === 'section'" class="flex flex-col gap-3">
        <h3
          v-if="node.title"
          class="text-sm font-semibold text-slate-900 dark:text-white"
        >
          {{ text(node.title) }}
        </h3>
        <UiNodes
          :plugin-id="pluginId"
          :nodes="node.children"
          :form-values="formValues"
          :busy="busy"
          @action="(a, f) => emit('action', a, f)"
          @field="(n, v) => emit('field', n, v)"
          @reload="emit('reload')"
          @params="(p) => emit('params', p)"
        />
      </section>
    </template>
  </div>
</template>
