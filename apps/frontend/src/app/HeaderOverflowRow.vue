<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import {
  HEADER_OVERFLOW,
  planOverflow,
  type OverflowCandidate,
  type OverflowRegistration,
} from './header-overflow';

// The row that measures the header's controls and collapses whatever no longer
// fits (#274). Controls declare a priority and register themselves through
// `HeaderItem`; a collapsed control re-appears inside the avatar menu, whose
// body registers itself as the teleport target via `HeaderOverflowSection`.
// There is no separate «more» button: the avatar is the row's fixed terminal,
// and the collapsed controls live behind it.

const rowRef = ref<HTMLElement | null>(null);
const panelBody = ref<HTMLElement | null>(null);

const collapsed = ref<string[]>([]);
const compacted = ref<string[]>([]);

const entries = new Map<string, OverflowRegistration>();
/** Widths survive a collapse: a collapsed control cannot be measured in place. */
const widths = new Map<string, { full: number; compact?: number }>();

// The flex `gap-3` between controls belongs to whichever control follows, so it
// is charged with it. MIN_TITLE_GAP is the least air `justify-between` keeps
// between the title and the first control.
const GAP = 12;
const MIN_TITLE_GAP = 24;

const invalidate = (): void => {
  widths.clear();
};

provide(HEADER_OVERFLOW, {
  register: (entry) => {
    entries.set(entry.id, entry);
    invalidate();
    void nextTick(() => {
      if (entry.el.value) itemObserver?.observe(entry.el.value);
      sync();
    });
  },
  unregister: (id) => {
    const el = entries.get(id)?.el.value;
    if (el) itemObserver?.unobserve(el);
    entries.delete(id);
    widths.delete(id);
    collapsed.value = collapsed.value.filter((c) => c !== id);
    void nextTick(sync);
  },
  isCollapsed: (id) => collapsed.value.includes(id),
  isCompact: (id) => compacted.value.includes(id),
  attachPanel: (el) => {
    panelBody.value = el;
  },
  detachPanel: () => {
    panelBody.value = null;
  },
  panelBody,
  collapsedCount: computed(() => collapsed.value.length),
});

/**
 * Read every control's width from the DOM.
 *
 * Runs only when the cache is empty (first pass, a locale change, a plugin
 * toggling) — never on an ordinary resize, where re-reading a control that is
 * currently collapsed would measure the wrong thing.
 */
const measureAll = (): void => {
  for (const [id, entry] of entries) {
    const el = entry.el.value;
    if (!el) continue;
    const full = el.offsetWidth + GAP;
    let compact: number | undefined;
    // The control's narrower form, DISCOVERED here rather than declared
    // (#277): an element carrying `data-compact-drop` inside the item is the
    // declaration. Checked on every measure, not at registration — a plugin's
    // control renders its markup only when its data arrives, and the next
    // measure picks the marker up for free. Measured by hiding what it drops:
    // a write, a read and a write back — inside the observer callback, so the
    // browser lays it out again before this frame is painted, nothing is seen.
    const drops = el.querySelectorAll<HTMLElement>('[data-compact-drop]');
    if (drops.length > 0) {
      const before = Array.from(drops, (d) => d.style.display);
      drops.forEach((d) => (d.style.display = 'none'));
      compact = el.offsetWidth + GAP;
      drops.forEach((d, i) => (d.style.display = before[i] ?? ''));
    }
    widths.set(id, { full, compact });
  }
};

let remeasuring = false;

/**
 * Restore every control to the row, let Vue put it back, then measure.
 *
 * A collapsed control lives in the menu, where its width is the menu's, not
 * the row's — so a cache rebuild has to un-collapse first. Guarded: two
 * overlapping passes measure the wrong thing — the second one resets the row,
 * then waits, and by the time it reads, the first pass has already applied a
 * plan, so a control that just went compact is measured without its label.
 *
 * The un-collapsed row is never painted: the restore, the `nextTick`
 * continuation and the re-plan all run in the microtasks of one task, and the
 * browser drains the microtask queue before it returns to painting — so the
 * `await` here does not open the "one wrong frame" that #278 warns about.
 */
const remeasure = async (): Promise<void> => {
  if (remeasuring) return;
  remeasuring = true;
  collapsed.value = [];
  compacted.value = [];
  await nextTick();
  measureAll();
  remeasuring = false;
  sync();
};

/**
 * Measure and decide, synchronously.
 *
 * The write MUST stay synchronous inside the ResizeObserver callback: the HTML
 * Standard re-runs style and layout after every observation broadcast and only
 * then paints, so a synchronous change is never seen in its wrong state.
 * Deferring it to `requestAnimationFrame` — the usual advice for suppressing
 * the loop error — would guarantee one visibly wrong frame instead. Researched
 * in #278; do not "optimise" this into a rAF or a debounce.
 */
const sync = (): void => {
  const row = rowRef.value;
  const boundary = row?.parentElement;
  if (!row || !boundary) return;

  // Nothing registered yet (first paint of an empty header) — leave it alone.
  if (entries.size === 0) return;

  if (widths.size !== entries.size) {
    void remeasure();
    return;
  }

  // The room the title actually needs, not a guess: the title never truncates
  // while a control could still give way instead. `scrollWidth` sees the full
  // text even when the `truncate` class is currently clipping it, so a title
  // squeezed by the previous pass still reserves its natural width.
  const left = boundary.firstElementChild;
  let reserve = MIN_TITLE_GAP;
  if (left instanceof HTMLElement) {
    reserve += left.offsetWidth;
    const title = left.querySelector('h1');
    if (title) reserve += title.scrollWidth - title.clientWidth;
  }

  const style = getComputedStyle(boundary);
  // `+ GAP`: every candidate is billed `width + GAP`, but a row of n controls
  // renders only n−1 gaps — without the refund the plan runs one gap short and
  // collapses ~12px before the width has actually run out.
  const budget =
    boundary.clientWidth -
    parseFloat(style.paddingLeft || '0') -
    parseFloat(style.paddingRight || '0') -
    reserve +
    GAP;

  const candidates: OverflowCandidate[] = [];
  for (const [id, entry] of entries) {
    const width = widths.get(id);
    if (!width) continue;
    // A slot that rendered nothing (its plugin is disabled) measures as bare
    // gap. It costs no width, so it must never collapse — a collapsed empty
    // control would put a dead, label-only row into the menu.
    if (width.full <= GAP + 1) continue;
    candidates.push({
      id,
      priority: entry.priority.value,
      width: width.full,
      compactWidth: width.compact,
    });
  }

  // No trigger to reserve for: the avatar that hosts the collapsed controls is
  // pinned and already charged as an ordinary candidate.
  const plan = planOverflow(candidates, budget, 0);
  collapsed.value = plan.collapsed;
  compacted.value = plan.compacted;
};

// No flight animation. It was tried (#274) and cut: the collapsing controls
// carry `backdrop-filter` glass, and animating their clones janked the whole
// header during a live resize. The affordance is the counter badge plus the
// one-time coachmark — see `HeaderOverflowBadge`.

let observer: ResizeObserver | null = null;
let itemObserver: ResizeObserver | null = null;

// A control's content can change size long after it registered — a PluginSlot
// renders empty until its plugin's data arrives, then grows to its real width.
// The cache would hold the empty measurement forever, the plan would budget
// 12px for a 230px control, and the row would visibly overflow. When a
// NON-collapsed control's rendered width stops matching its cached width, the
// cache is stale — rebuild it. Collapsed controls are skipped (their width is
// the panel's), and an identical width is a no-op, which is what terminates
// the measure→resize→measure feedback this observer would otherwise loop on.
const onItemResize = (entriesSeen: ResizeObserverEntry[]): void => {
  for (const seen of entriesSeen) {
    const target = seen.target;
    if (!(target instanceof HTMLElement)) continue;
    const entry = [...entries.values()].find((e) => e.el.value === target);
    if (!entry || collapsed.value.includes(entry.id)) continue;
    const cached = widths.get(entry.id)?.full;
    if (cached === undefined) continue;
    const now = target.offsetWidth + GAP;
    if (Math.abs(now - cached) > 0.5) {
      invalidate();
      void nextTick(sync);
      return;
    }
  }
};

onMounted(() => {
  const boundary = rowRef.value?.parentElement;
  // Observing the header rather than the row itself: hiding a control changes
  // the row's width, and an observation at the same depth as the write is
  // deferred to the next frame with a loop error. The header's own width does
  // not depend on its contents, so the feedback loop cannot form.
  if (boundary && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => sync());
    observer.observe(boundary);
    itemObserver = new ResizeObserver(onItemResize);
    for (const entry of entries.values()) {
      if (entry.el.value) itemObserver.observe(entry.el.value);
    }
  }
  sync();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  itemObserver?.disconnect();
  itemObserver = null;
});

// A translated label is a different width; so is a control a plugin has just
// contributed. Both invalidate what was measured. The page title changes width
// per route, and it shares the line — watch it too.
const { locale } = useI18n();
watch(locale, () => {
  invalidate();
  void nextTick(sync);
});

defineExpose({
  /** Route changes retitle the header; the shell nudges the row to re-plan. */
  sync: (): void => void nextTick(sync),
});

const count = computed(() => collapsed.value.length);
</script>

<template>
  <div ref="rowRef" class="flex items-center gap-3 min-w-0">
    <slot />
    <!-- The row's fixed terminal — the avatar/user menu that also hosts the
         collapsed controls. Scoped `count` lets it say how many it holds. -->
    <slot name="trailing" :count="count" />
  </div>
</template>
