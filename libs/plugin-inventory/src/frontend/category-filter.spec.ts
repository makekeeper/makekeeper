import {
  ALL_CATEGORIES,
  NO_CATEGORY,
  buildDescendantIndex,
  matchesCategoryFilter,
  type CategoryNode,
} from './category-filter';

// yarn → wool → merino, plus a second branch that shares a leaf NAME with the
// first. Filtering used to go by name, which folded the two into one (#205).
const TREE: CategoryNode[] = [
  { id: 'yarn', parentId: null },
  { id: 'wool', parentId: 'yarn' },
  { id: 'merino', parentId: 'wool' },
  { id: 'tools', parentId: null },
  { id: 'needles', parentId: 'tools' },
];

describe('buildDescendantIndex', () => {
  it('includes the category itself', () => {
    expect([...(buildDescendantIndex(TREE).get('merino') ?? [])]).toEqual([
      'merino',
    ]);
  });

  it('reaches a grandchild, not only the direct children', () => {
    expect(buildDescendantIndex(TREE).get('yarn')).toEqual(
      new Set(['yarn', 'wool', 'merino']),
    );
  });

  it('keeps sibling branches apart', () => {
    const index = buildDescendantIndex(TREE);
    expect(index.get('tools')).toEqual(new Set(['tools', 'needles']));
    expect(index.get('yarn')?.has('needles')).toBe(false);
  });

  it('terminates on a cycle the server should never send', () => {
    const index = buildDescendantIndex([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]);
    // The guard is that this returns at all; what it contains beyond the node
    // itself is undefined behaviour for undefined data.
    expect(index.get('a')?.has('a')).toBe(true);
  });

  it('keeps a category whose parent is missing reachable on its own', () => {
    // The parent may be outside the loaded set (a scope the person cannot see).
    const index = buildDescendantIndex([{ id: 'orphan', parentId: 'gone' }]);
    expect(index.get('orphan')).toEqual(new Set(['orphan']));
  });
});

describe('matchesCategoryFilter', () => {
  const index = buildDescendantIndex(TREE);

  it('lets everything through when no category is chosen', () => {
    expect(matchesCategoryFilter(null, ALL_CATEGORIES, index)).toBe(true);
    expect(matchesCategoryFilter('merino', ALL_CATEGORIES, index)).toBe(true);
  });

  it('matches only uncategorised items on the empty filter', () => {
    expect(matchesCategoryFilter(null, NO_CATEGORY, index)).toBe(true);
    expect(matchesCategoryFilter('yarn', NO_CATEGORY, index)).toBe(false);
  });

  it('matches the whole branch, not just the exact node', () => {
    expect(matchesCategoryFilter('merino', 'yarn', index)).toBe(true);
    expect(matchesCategoryFilter('wool', 'yarn', index)).toBe(true);
    expect(matchesCategoryFilter('needles', 'yarn', index)).toBe(false);
  });

  it('does not match upwards — a parent is not inside its child', () => {
    expect(matchesCategoryFilter('yarn', 'merino', index)).toBe(false);
  });

  it('drops an uncategorised item from a real category filter', () => {
    expect(matchesCategoryFilter(null, 'yarn', index)).toBe(false);
  });

  it('falls back to the exact id while the vocabulary is still loading', () => {
    // An empty index is the first paint: the rows are there, the tree is not.
    // Dropping every row then would read as "the filter found nothing".
    const empty = new Map<string, Set<string>>();
    expect(matchesCategoryFilter('yarn', 'yarn', empty)).toBe(true);
    expect(matchesCategoryFilter('merino', 'yarn', empty)).toBe(false);
  });
});
