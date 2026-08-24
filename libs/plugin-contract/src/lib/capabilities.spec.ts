import { isPhoneBridgeScanSessionData } from './capabilities';

// The scan session's `data` reaches the phone over the PUBLIC bridge route, so
// the surface must narrow it instead of trusting the desktop wrote it (#79).
describe('isPhoneBridgeScanSessionData', () => {
  it('accepts a well-formed action list', () => {
    expect(
      isPhoneBridgeScanSessionData({
        actions: [
          {
            key: 'place',
            labelKey: 'inventory.cellScan.place',
            labelParams: { cell: 'B1' },
            entityTypes: ['component'],
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts an empty action list (a session offering nothing)', () => {
    expect(isPhoneBridgeScanSessionData({ actions: [] })).toBe(true);
  });

  it('rejects anything that is not an action list', () => {
    expect(isPhoneBridgeScanSessionData(undefined)).toBe(false);
    expect(isPhoneBridgeScanSessionData(null)).toBe(false);
    expect(isPhoneBridgeScanSessionData({})).toBe(false);
    expect(isPhoneBridgeScanSessionData({ actions: 'place' })).toBe(false);
  });

  it('rejects an action missing its key or label', () => {
    expect(isPhoneBridgeScanSessionData({ actions: [{ key: 'place' }] })).toBe(
      false,
    );
    expect(
      isPhoneBridgeScanSessionData({ actions: [{ labelKey: 'a.b' }] }),
    ).toBe(false);
    expect(isPhoneBridgeScanSessionData({ actions: [null] })).toBe(false);
  });
});
