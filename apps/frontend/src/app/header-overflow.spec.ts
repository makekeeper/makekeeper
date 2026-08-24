import { describe, expect, it } from 'vitest';
import {
  HEADER_PRIORITY,
  HEADER_SLOTS,
  PANEL_SLOT_STRIDE,
  panelOrderFor,
  planOverflow,
  priorityFor,
  type OverflowCandidate,
} from './header-overflow';

const TRIGGER = 56;

const candidate = (
  id: string,
  priority: number,
  width: number,
  compactWidth?: number,
): OverflowCandidate => ({ id, priority, width, compactWidth });

describe('planOverflow', () => {
  it('keeps everything when the budget is ample', () => {
    const plan = planOverflow(
      [candidate('a', 3, 100), candidate('b', 2, 100), candidate('c', 1, 100)],
      1000,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual([]);
    expect(plan.compacted).toEqual([]);
  });

  it('sheds the lowest priority first', () => {
    const plan = planOverflow(
      [candidate('a', 3, 100), candidate('b', 2, 100), candidate('c', 1, 100)],
      // room for two controls plus the trigger
      256,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual(['c']);
  });

  it('reserves room for the overflow trigger itself', () => {
    // 200 fits two 100px controls exactly — but not once the trigger has to
    // sit beside them, so a second control gives way.
    const plan = planOverflow(
      [candidate('a', 3, 100), candidate('b', 2, 100), candidate('c', 1, 100)],
      200,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual(['c', 'b']);
  });

  it('does not reserve the trigger once nothing is left to hide', () => {
    const plan = planOverflow(
      [candidate('a', 2, 100), candidate('b', 1, 100)],
      200,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual([]);
  });

  it('charges a pinned control against the budget but never collapses it', () => {
    const plan = planOverflow(
      [
        candidate('user', Number.POSITIVE_INFINITY, 44),
        candidate('a', 2, 100),
        candidate('b', 1, 100),
      ],
      // 44 pinned + 100 + 56 trigger = exactly 200; 'b' is what does not fit.
      200,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual(['b']);
    expect(plan.collapsed).not.toContain('user');
  });

  it('collapses a pinned-only row to nothing', () => {
    const plan = planOverflow(
      [candidate('user', Number.POSITIVE_INFINITY, 44)],
      10,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual([]);
  });

  it('takes the narrower form before giving up the place', () => {
    // 44 pinned + 36 compact + 56 trigger = 136; the full 127 would not fit.
    const plan = planOverflow(
      [
        candidate('user', Number.POSITIVE_INFINITY, 44),
        candidate('ai', 8, 127, 36),
        candidate('search', 7, 240),
      ],
      140,
      TRIGGER,
    );
    expect(plan.compacted).toEqual(['ai']);
    expect(plan.collapsed).toEqual(['search']);
  });

  it('gives up the place when even the narrower form does not fit', () => {
    const plan = planOverflow(
      [
        candidate('user', Number.POSITIVE_INFINITY, 44),
        candidate('ai', 8, 127, 36),
        candidate('search', 7, 240),
      ],
      60,
      TRIGGER,
    );
    expect(plan.compacted).toEqual([]);
    expect(plan.collapsed).toEqual(['search', 'ai']);
  });

  it('stops at the first control that does not fit, never reordering the row', () => {
    // 'wide' does not fit, so 'narrow' below it stays hidden even though it
    // would have fitted — the row keeps its order.
    const plan = planOverflow(
      [candidate('wide', 3, 500), candidate('narrow', 2, 10)],
      200,
      TRIGGER,
    );
    expect(plan.collapsed).toEqual(['narrow', 'wide']);
  });

  it('spends a narrower form before evicting another control', () => {
    // Full widths need 44 + 127 + 60 + 56 = 287 > 260, so something must go.
    // Compacting 'ai' to 36 saves more than evicting 'small', so it wins and
    // every control keeps its place.
    const plan = planOverflow(
      [
        candidate('user', Number.POSITIVE_INFINITY, 44),
        candidate('ai', 8, 127, 36),
        candidate('small', 7, 60),
      ],
      200,
      TRIGGER,
    );
    expect(plan.compacted).toEqual(['ai']);
    expect(plan.collapsed).toEqual([]);
  });

  it('stays monotonic: narrowing never brings a control back', () => {
    const row: OverflowCandidate[] = [
      candidate('user', Number.POSITIVE_INFINITY, 44),
      candidate('ai', 8, 127, 36),
      candidate('a', 7, 60),
      candidate('b', 6, 60),
      candidate('c', 5, 60),
    ];
    let previous = -1;
    for (let budget = 400; budget >= 80; budget -= 4) {
      const { collapsed } = planOverflow(row, budget, TRIGGER);
      expect(collapsed.length).toBeGreaterThanOrEqual(previous);
      previous = collapsed.length;
    }
  });

  it('never takes a spent label back as the row narrows further', () => {
    const row: OverflowCandidate[] = [
      candidate('user', Number.POSITIVE_INFINITY, 44),
      candidate('ai', 8, 127, 36),
      candidate('a', 7, 60),
      candidate('b', 6, 60),
      candidate('c', 5, 60),
    ];
    let compactedOnce = false;
    for (let budget = 400; budget >= 80; budget -= 4) {
      const { compacted, collapsed } = planOverflow(row, budget, TRIGGER);
      const isCompact = compacted.includes('ai');
      if (isCompact) compactedOnce = true;
      // Once spent, it stays spent — until the control leaves the row entirely.
      if (compactedOnce && !collapsed.includes('ai')) {
        expect(isCompact).toBe(true);
      }
    }
    expect(compactedOnce).toBe(true);
  });

  it('sends the AI button out first while the chat panel is open', () => {
    const open: OverflowCandidate[] = [
      candidate('ai', HEADER_PRIORITY.aiAssistantChatOpen, 127),
      candidate('search', HEADER_PRIORITY.search, 240),
      candidate('scheme', HEADER_PRIORITY.scheme, 44),
    ];
    // Enough for the search box and the trigger, nothing more.
    const plan = planOverflow(open, 300, TRIGGER);
    expect(plan.collapsed[0]).toBe('ai');
    expect(plan.collapsed).not.toContain('search');
  });

  it('keeps the AI button longest while the chat panel is closed', () => {
    const closed: OverflowCandidate[] = [
      candidate('ai', HEADER_PRIORITY.aiAssistant, 127),
      candidate('search', HEADER_PRIORITY.search, 240),
      candidate('scheme', HEADER_PRIORITY.scheme, 44),
    ];
    const plan = planOverflow(closed, 300, TRIGGER);
    expect(plan.collapsed).not.toContain('ai');
    expect(plan.collapsed).toContain('scheme');
  });
});

describe('priorityFor', () => {
  it('gives the leftmost contribution the largest refinement', () => {
    // Three contributions in one slot: index 0 stands leftmost and must
    // survive longest — collapse walks from the right.
    const p0 = priorityFor(6, 0, 3);
    const p1 = priorityFor(6, 1, 3);
    const p2 = priorityFor(6, 2, 3);
    expect(p0).toBeGreaterThan(p1);
    expect(p1).toBeGreaterThan(p2);
  });

  it('never lets a contribution cross its slot boundary', () => {
    // Whatever the slot population, the refined priority stays inside
    // [slot, slot + 1) — a plugin cannot outrank another slot by `order`.
    for (const count of [1, 2, 5, 50]) {
      for (let index = 0; index < count; index++) {
        const p = priorityFor(6, index, count);
        expect(p).toBeGreaterThanOrEqual(6);
        expect(p).toBeLessThan(7);
      }
    }
  });

  it('collapses a slot with two contributions right-to-left', () => {
    const row: OverflowCandidate[] = [
      candidate('user', Number.POSITIVE_INFINITY, 44),
      candidate('scan:codes', priorityFor(HEADER_PRIORITY.scan, 0, 2), 44),
      candidate('scan:mobile', priorityFor(HEADER_PRIORITY.scan, 1, 2), 44),
    ];
    // Room for the pinned avatar and exactly one scan control.
    const plan = planOverflow(row, 100, 0);
    expect(plan.collapsed).toEqual(['scan:mobile']);
  });

  it('keeps the integral shell priorities uncollidable with refined ones', () => {
    // The uxMode control (4) must still collapse before ANY scan
    // contribution (6 + fraction), however the slot refines.
    expect(priorityFor(HEADER_PRIORITY.scan, 9, 10)).toBeGreaterThan(
      HEADER_PRIORITY.uxMode,
    );
  });
});

describe('panelOrderFor', () => {
  it('keeps slot blocks apart and rows in reading order within a block', () => {
    const searchSlot = HEADER_SLOTS[0];
    const scanSlot = HEADER_SLOTS[1];
    if (!searchSlot || !scanSlot) throw new Error('HEADER_SLOTS changed');
    const searchRow = panelOrderFor(searchSlot.panelOrder, 0);
    const scanFirst = panelOrderFor(scanSlot.panelOrder, 0);
    const scanSecond = panelOrderFor(scanSlot.panelOrder, 1);
    expect(searchRow).toBeLessThan(scanFirst);
    expect(scanFirst).toBeLessThan(scanSecond);
    // A slot cannot spill into the next block.
    expect(scanSecond).toBeLessThan(
      (scanSlot.panelOrder + 1) * PANEL_SLOT_STRIDE,
    );
  });
});
