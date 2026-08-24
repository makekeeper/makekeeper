// Flattening an id/parentId table into the depth-first, depth-tagged option list
// `Select` renders as a tree.
//
// It lives here rather than in the plugin that first needed it (inventory's
// category vocabulary, #205) because the shape it produces is the shared
// primitive's, and because the second caller was in a DIFFERENT plugin —
// projects' inline "create a component" form, which may not import inventory's
// code (§5.10). Two copies of a tree walk is how two pickers of the same data
// end up ordering it differently.

export interface TreeOption<TValue> {
  value: TValue;
  label: string;
  depth: number;
  parentValue: TValue | null;
}

export interface TreeOptionSource<TValue> {
  value: TValue;
  label: string;
  parentValue: TValue | null;
  // Position among siblings. Ties, and rows with no order at all, fall back to
  // the label so the list never reshuffles between two renders of the same data.
  order?: number;
}

// Deeper than any vocabulary a person curates by hand. This is a guard against
// a cycle the server should never send, not a design limit — a parent chain
// that loops would otherwise walk until the tab dies.
const MAX_DEPTH = 32;

export function buildTreeOptions<TValue>(
  items: ReadonlyArray<TreeOptionSource<TValue>>,
): Array<TreeOption<TValue>> {
  const childrenOf = new Map<TValue | null, Array<TreeOptionSource<TValue>>>();
  const known = new Set<TValue>(items.map((item) => item.value));
  for (const item of items) {
    // A row whose parent is not in the set would otherwise vanish: it hangs off
    // nothing this list contains, so it belongs at the top level.
    const parent =
      item.parentValue !== null && known.has(item.parentValue)
        ? item.parentValue
        : null;
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push(item);
    childrenOf.set(parent, siblings);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label),
    );
  }

  const out: Array<TreeOption<TValue>> = [];
  const seen = new Set<TValue>();
  const walk = (parent: TValue | null, depth: number): void => {
    if (depth >= MAX_DEPTH) return;
    for (const item of childrenOf.get(parent) ?? []) {
      if (seen.has(item.value)) continue;
      seen.add(item.value);
      out.push({
        value: item.value,
        label: item.label,
        depth,
        parentValue: parent,
      });
      walk(item.value, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
