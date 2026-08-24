import { describe, it, expect } from 'vitest';
import {
  BRAND_MARK_CELL,
  BRAND_MARK_CELLS,
  BRAND_MARK_GRID,
  BRAND_MARK_SIZE,
  brandMarkSvg,
} from './brand-mark';

describe('brand mark geometry', () => {
  it('keeps the source artwork’s 21 cells inside a 6×6 grid', () => {
    expect(BRAND_MARK_CELLS).toHaveLength(21);
    for (const [column, row] of BRAND_MARK_CELLS) {
      expect(column).toBeGreaterThanOrEqual(0);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(BRAND_MARK_GRID);
      expect(row).toBeLessThan(BRAND_MARK_GRID);
    }
    expect(new Set(BRAND_MARK_CELLS.map(String)).size).toBe(
      BRAND_MARK_CELLS.length,
    );
  });

  // The whole point of re-cropping the artwork (#260): the source padded 1 unit
  // on two sides and 3.6 on the other two, so the mark sat off-centre in any
  // box that centred it. Painted cells must now touch every edge.
  it('is flush to its own box on all four edges', () => {
    const columns = BRAND_MARK_CELLS.map(([column]) => column);
    const rows = BRAND_MARK_CELLS.map(([, row]) => row);
    expect(Math.min(...columns)).toBe(0);
    expect(Math.min(...rows)).toBe(0);
    expect(Math.max(...columns)).toBe(BRAND_MARK_GRID - 1);
    expect(Math.max(...rows)).toBe(BRAND_MARK_GRID - 1);
  });
});

describe('brandMarkSvg', () => {
  it('renders every cell knocked out of a tile in the given colour', () => {
    const svg = brandMarkSvg({ accent: '#f59e0b' });
    expect(svg).toContain('fill="#f59e0b"');
    expect(svg).toContain('fill="#ffffff"');
    // 21 glyph cells plus the tile itself.
    expect(svg.match(/<rect /g)).toHaveLength(BRAND_MARK_CELLS.length + 1);
  });

  it('scales the glyph to sit inside the requested padding', () => {
    const svg = brandMarkSvg({ accent: '#000000', padding: 0.25 });
    // 64 * 0.25 per edge; the glyph then fills what is left of the 64 box.
    expect(svg).toContain('translate(16 16)');
    expect(svg).toContain(`scale(${32 / BRAND_MARK_SIZE})`);
    expect(BRAND_MARK_SIZE).toBeCloseTo(47.4, 5);
    expect(BRAND_MARK_CELL).toBe(7.4);
  });
});
