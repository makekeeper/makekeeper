import { isResolvedChatContext } from './page-context';

// The guard exists because the shell parses this straight off the wire (#129).
// What it has to catch is not a hostile payload but an honest mismatch: an older
// server, a proxy's error page, a half-shaped answer — anything that would make
// the panel state a context nobody resolved.

describe('isResolvedChatContext', () => {
  it('accepts a fully resolved context', () => {
    expect(
      isResolvedChatContext({
        project: { id: 'p1', name: 'Workbench lamp' },
        page: { name: 'B1', breadcrumb: 'Office / Working Table' },
        filing: { name: 'Workbench lamp' },
      }),
    ).toBe(true);
  });

  // Every part is independently absent in normal use — no project in scope, no
  // page object published, nowhere for a file to go — so null is a valid
  // answer, not a missing one.
  it('accepts any part being null', () => {
    expect(
      isResolvedChatContext({ project: null, page: null, filing: null }),
    ).toBe(true);
    expect(
      isResolvedChatContext({
        project: { id: 'p1', name: 'Workbench lamp' },
        page: null,
        filing: { name: 'Workbench lamp' },
      }),
    ).toBe(true);
  });

  it('accepts a page object with no breadcrumb', () => {
    expect(
      isResolvedChatContext({
        project: null,
        page: { name: 'Workbench lamp', breadcrumb: null },
        filing: null,
      }),
    ).toBe(true);
  });

  // A part that is absent rather than null is the shape an OLDER server sends:
  // `filing` was added by #130, and a panel that reads its absence as "nowhere"
  // would quietly stop naming where files go.
  it('rejects a part that is absent rather than null', () => {
    expect(isResolvedChatContext({ project: null })).toBe(false);
    expect(isResolvedChatContext({ page: null })).toBe(false);
    expect(isResolvedChatContext({ project: null, page: null })).toBe(false);
  });

  it('rejects a half whose fields are the wrong shape', () => {
    expect(
      isResolvedChatContext({
        project: { id: 'p1' },
        page: null,
        filing: null,
      }),
    ).toBe(false);
    expect(
      isResolvedChatContext({
        project: null,
        page: { name: 'B1' },
        filing: null,
      }),
    ).toBe(false);
    expect(
      isResolvedChatContext({
        project: null,
        page: { name: 'B1', breadcrumb: 7 },
        filing: null,
      }),
    ).toBe(false);
    expect(
      isResolvedChatContext({ project: null, page: null, filing: { name: 7 } }),
    ).toBe(false);
  });

  it('rejects what is not an object at all', () => {
    expect(isResolvedChatContext(null)).toBe(false);
    expect(isResolvedChatContext(undefined)).toBe(false);
    expect(isResolvedChatContext('<html>502 Bad Gateway</html>')).toBe(false);
  });
});
