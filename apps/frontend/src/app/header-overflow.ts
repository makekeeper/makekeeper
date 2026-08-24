import type { InjectionKey, Ref } from 'vue';

/**
 * Priority-based overflow for the app header (#274).
 *
 * The header is a single row whose right group is extended by plugins, so no
 * breakpoint scheme can be correct: the number of controls is not known at
 * build time. Instead every control declares how long it should survive, the
 * row is measured, and whatever no longer fits moves into an overflow panel.
 *
 * `Number.POSITIVE_INFINITY` marks a control that never collapses.
 */
export interface OverflowCandidate {
  id: string;
  /** Higher survives longer. `Infinity` never collapses. */
  priority: number;
  /** Width of the control in its full form, including its trailing gap. */
  width: number;
  /**
   * Width of the control's narrower form, if it has one (the AI button drops
   * its label before it drops its place). Omitted when there is no such form.
   */
  compactWidth?: number;
}

export interface OverflowPlan {
  /** Ids that moved into the overflow panel, in the order they gave way. */
  collapsed: string[];
  /** Ids that stayed, but in their narrower form. */
  compacted: string[];
}

/**
 * Decide what fits.
 *
 * Fills from the most important control down and stops at the first one that
 * does not fit — a strict priority order, never a "skip this one and try the
 * next" that would reorder the row. Space for the overflow trigger is reserved
 * for as long as anything is still going to be hidden behind it, which is the
 * detail hand-rolled implementations usually miss.
 */
export function planOverflow(
  candidates: readonly OverflowCandidate[],
  budget: number,
  triggerWidth: number,
): OverflowPlan {
  const plan = fill(candidates, budget, triggerWidth);
  if (plan.collapsed.length === 0) return plan;

  // Something had to go. Before accepting that, spend the narrower forms first:
  // a control giving up its label is a smaller loss than another control giving
  // up its place. Without this the row is not monotonic — narrowing the window
  // could compact one control and thereby let another one back in, which reads
  // as the header changing its mind.
  const compactedAll = candidates.map((c) =>
    c.compactWidth !== undefined && !plan.compacted.includes(c.id)
      ? { ...c, width: c.compactWidth }
      : c,
  );
  if (compactedAll.every((c, i) => c.width === candidates[i]?.width)) {
    return plan;
  }

  // Accepted whenever it is no worse, not only when it saves a control: once
  // the row is over its budget the label is spent and stays spent. Taking it
  // back the moment compacting stops paying for itself would mean the label
  // reappears as the window narrows further.
  const retry = fill(compactedAll, budget, triggerWidth);
  if (retry.collapsed.length > plan.collapsed.length) return plan;

  return {
    collapsed: retry.collapsed,
    compacted: candidates
      .filter(
        (c) => c.compactWidth !== undefined && !retry.collapsed.includes(c.id),
      )
      .map((c) => c.id),
  };
}

function fill(
  candidates: readonly OverflowCandidate[],
  budget: number,
  triggerWidth: number,
): OverflowPlan {
  const collapsible = candidates.filter((c) => Number.isFinite(c.priority));
  const pinnedWidth = candidates
    .filter((c) => !Number.isFinite(c.priority))
    .reduce((sum, c) => sum + c.width, 0);

  const byImportance = [...collapsible].sort((a, b) => b.priority - a.priority);
  const kept = new Set<string>();
  const compacted: string[] = [];
  let used = pinnedWidth;

  for (const candidate of byImportance) {
    // While anything is still going to be hidden, the trigger needs its own room.
    const reserve = kept.size + 1 < collapsible.length ? triggerWidth : 0;
    const fits = (width: number): boolean => used + width + reserve <= budget;

    if (fits(candidate.width)) {
      used += candidate.width;
      kept.add(candidate.id);
      continue;
    }
    if (candidate.compactWidth !== undefined && fits(candidate.compactWidth)) {
      used += candidate.compactWidth;
      kept.add(candidate.id);
      compacted.push(candidate.id);
      continue;
    }
    break;
  }

  const collapsed = [...collapsible]
    .sort((a, b) => a.priority - b.priority)
    .filter((c) => !kept.has(c.id))
    .map((c) => c.id);

  return { collapsed, compacted };
}

/**
 * What a header control registers with the row that measures it. The element is
 * needed because the row measures the rendered control rather than trusting a
 * declared width — a translated label or a plugin's own markup decides it.
 */
export interface OverflowRegistration {
  id: string;
  priority: Ref<number>;
  el: Ref<HTMLElement | null>;
}

export interface HeaderOverflowContext {
  register: (entry: OverflowRegistration) => void;
  unregister: (id: string) => void;
  isCollapsed: (id: string) => boolean;
  isCompact: (id: string) => boolean;
  /**
   * The avatar menu's body claims/releases itself as the teleport target for
   * collapsed controls. The menu mounts its body only while open, so the
   * target comes and goes; a collapsed control without a target simply hides.
   */
  attachPanel: (el: HTMLElement) => void;
  detachPanel: () => void;
  panelBody: Ref<HTMLElement | null>;
  /** How many controls are currently collapsed — the menu's section shows it. */
  collapsedCount: Ref<number>;
}

export const HEADER_OVERFLOW: InjectionKey<HeaderOverflowContext> =
  Symbol('mk-header-overflow');

/**
 * Priority table for the app's own header controls (#274).
 *
 * Deliberately not a per-control constant: priority depends on what else is on
 * screen. With the chat panel already open, the button that opens the chat is
 * the first thing to go — it duplicates what the user is looking at.
 */
export const HEADER_PRIORITY = {
  userMenu: Number.POSITIVE_INFINITY,
  aiAssistant: 8,
  /** The same button while the chat panel is open. */
  aiAssistantChatOpen: 0.5,
  search: 7,
  scan: 6,
  uxMode: 4,
  language: 3,
  theme: 2,
  scheme: 1,
} as const;

/**
 * The plugin-facing slots of the app header, in one place (#277).
 *
 * This table IS the catalogue: a slot exists only where the shell renders it,
 * so there is nothing else to close the set with. The rank belongs to the slot
 * — a plugin can order itself among its slot's neighbours (the contribution's
 * existing `order`), never against another slot; `priorityFor` keeps that
 * arithmetic, not convention. A new header role is a new row here, with a
 * deliberate rank, not a shared free-for-all slot.
 *
 * `HEADER_PRIORITY` stays integral on purpose: the fraction `priorityFor`
 * adds within a slot lives in [0, 1), so integer ranks can never collide with
 * a refined one.
 */
export interface HeaderSlotSpec {
  name: string;
  priority: number;
  /** The slot's block in the avatar menu; rows within it keep the row order. */
  panelOrder: number;
  /** The contribution IS its own menu row — no label beside it, full width. */
  panelFull: boolean;
}

export const HEADER_SLOTS: readonly HeaderSlotSpec[] = [
  {
    name: 'app.header.search',
    priority: HEADER_PRIORITY.search,
    panelOrder: 1,
    panelFull: true,
  },
  {
    name: 'app.header.scan',
    priority: HEADER_PRIORITY.scan,
    panelOrder: 2,
    panelFull: false,
  },
];

/** Menu rows: slot block × stride + row order within the slot. */
export const PANEL_SLOT_STRIDE = 100;

/**
 * One contribution's place on the header's priority scale.
 *
 * `index` is the position in the slot's `order`-sorted contribution list — the
 * only thing the raw `order` value buys. The fraction stays in [0, 1) whatever
 * `order` said, so no contribution can cross its slot's boundary and outrank
 * another slot by picking a large number. Leftmost (lowest `order`) gets the
 * largest fraction: collapse walks from the right.
 */
export function priorityFor(
  slotPriority: number,
  index: number,
  count: number,
): number {
  if (count <= 0) return slotPriority;
  return slotPriority + (count - 1 - index) / count;
}

/**
 * One contribution's flex `order` inside the avatar menu: rows read
 * left-to-right as the row did, independent of the collapse history.
 */
export function panelOrderFor(slotPanelOrder: number, index: number): number {
  return slotPanelOrder * PANEL_SLOT_STRIDE + index;
}
