import { carryOverPatch } from './print-contract';

// The rule behind the one-time carry-over (#366): an instance that never saved
// print settings takes what a browser remembers from when they lived in
// browsers. Everything else leaves the instance alone — a second admin's
// browser must not overwrite what the first one handed over.

describe('carryOverPatch', () => {
  const mine = { density: 5, labelType: 'black' } as const;

  it('hands over what this browser remembers', () => {
    expect(carryOverPatch(mine, false)).toEqual(mine);
  });

  it('leaves a configured instance alone', () => {
    expect(carryOverPatch(mine, true)).toBeNull();
  });

  it('writes nothing before the instance has been asked', () => {
    expect(carryOverPatch(mine, null)).toBeNull();
  });

  it('has nothing to hand over from a browser that never printed', () => {
    expect(carryOverPatch(null, false)).toBeNull();
    expect(carryOverPatch({}, false)).toBeNull();
  });

  it('hands over a half-remembered browser as far as it goes', () => {
    expect(carryOverPatch({ density: 2 }, false)).toEqual({ density: 2 });
  });
});
