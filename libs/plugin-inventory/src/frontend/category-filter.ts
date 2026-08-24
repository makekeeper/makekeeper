// The category filter's two rules, kept out of the view so they can be tested
// without mounting the whole inventory page (#205). Both are pure functions over
// the category vocabulary — the view owns only the refs they read from.

// A category as the filter needs it: an id and its parent, nothing else.
export interface CategoryNode {
  id: string;
  parentId: string | null;
}

// The two synthetic values the picker adds above the tree. They are not ids, so
// they can never collide with one.
export const ALL_CATEGORIES = '__all__';
export const NO_CATEGORY = '__none__';

// Every category under a given one, itself included. Picking a branch means the
// branch: a tree that offered "Пряжа" and then showed nothing because the items
// are all in "Пряжа → Шерсть" would be a tree in appearance only.
export function buildDescendantIndex(
  categories: readonly CategoryNode[],
): Map<string, Set<string>> {
  const children = new Map<string | null, string[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category.id);
    children.set(category.parentId, siblings);
  }
  const index = new Map<string, Set<string>>();
  const collect = (id: string): Set<string> => {
    const cached = index.get(id);
    if (cached) return cached;
    const set = new Set<string>([id]);
    // Set before recursing: a cycle the server should never send would
    // otherwise walk until the tab dies.
    index.set(id, set);
    for (const child of children.get(id) ?? []) {
      for (const value of collect(child)) set.add(value);
    }
    return set;
  };
  for (const category of categories) collect(category.id);
  return index;
}

// Matched by category ID, not name (#205): two categories in different branches
// may legitimately share a name, and filtering by the label folded them into one.
export function matchesCategoryFilter(
  itemCategoryId: string | null,
  selected: string,
  descendants: Map<string, Set<string>>,
): boolean {
  if (selected === ALL_CATEGORIES) return true;
  if (selected === NO_CATEGORY) return itemCategoryId === null;
  if (!itemCategoryId) return false;
  // No entry means the vocabulary has not loaded yet (or the category is gone):
  // fall back to the exact match rather than dropping the row.
  return (
    descendants.get(selected)?.has(itemCategoryId) ??
    itemCategoryId === selected
  );
}
