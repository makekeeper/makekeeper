import { computeShortfall } from './inventory.service';

describe('computeShortfall', () => {
  it('is zero when free stock covers both threshold and demand', () => {
    expect(computeShortfall(10, 5, 3)).toBe(0);
    expect(computeShortfall(5, 5, 5)).toBe(0);
  });

  it('fills up to the min-stock threshold when demand is lower', () => {
    expect(computeShortfall(2, 5, 0)).toBe(3);
  });

  it('fills up to the unmet project demand when it exceeds the threshold', () => {
    expect(computeShortfall(1, 2, 8)).toBe(7);
  });

  it('supports fractional quantities', () => {
    expect(computeShortfall(0.5, 2, 0)).toBeCloseTo(1.5);
  });

  it('subtracts stock already on order from what still needs buying', () => {
    // target 5, none in stock, 2 on order → buy the remaining 3
    expect(computeShortfall(0, 5, 0, 2)).toBe(3);
  });

  it('is zero when pending orders already cover the shortfall', () => {
    expect(computeShortfall(0, 5, 0, 5)).toBe(0);
    expect(computeShortfall(0, 5, 0, 9)).toBe(0);
  });

  it('defaults onOrder to zero when omitted', () => {
    expect(computeShortfall(2, 5, 0)).toBe(3);
  });
});
