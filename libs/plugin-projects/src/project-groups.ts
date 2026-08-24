// The project-group contract (#285): the folder tree that holds projects.
// Framework-agnostic (no Nest, no Vue) so backend and frontend share ONE
// definition, exactly like `bench.ts` and `manifest.ts`.

// How deep the tree is walked before a caller gives up. A cycle cannot be
// created through the service (the move guard refuses one), but a walk that
// trusts the data would hang instead of failing, and this tree is hand-made and
// shallow by nature — nobody files projects fifteen folders down.
export const PROJECT_GROUP_MAX_DEPTH = 20;

// What joins the segments of a group path. Structure, not prose: it is the
// same in every locale, which is why it is here and not in a locale file.
export const GROUP_PATH_SEPARATOR = ' / ';

export interface ProjectGroupDto {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  // The scope's General group: renameable, never deletable, and the destination
  // for anything left behind when a root group is deleted.
  isDefault: boolean;
}

// Case-insensitive, whitespace-trimmed comparison for name collisions among
// siblings. Two spellings of the same folder is a mistake being made, not a
// distinction being drawn.
export function normalizeGroupName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

// Every id in the subtree rooted at `rootId`, the root included. The single
// descendant-resolution helper the whole feature uses — filtering projects by a
// group is descendant-inclusive, and a second tree walk per call site is how
// the two answers drift apart.
export function collectGroupSubtreeIds(
  rootId: string,
  groups: ReadonlyArray<Pick<ProjectGroupDto, 'id' | 'parentId'>>,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    const key = group.parentId ?? '';
    const siblings = childrenByParent.get(key);
    if (siblings) siblings.push(group.id);
    else childrenByParent.set(key, [group.id]);
  }
  const collected: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number): void => {
    if (depth > PROJECT_GROUP_MAX_DEPTH || seen.has(id)) return;
    seen.add(id);
    collected.push(id);
    for (const child of childrenByParent.get(id) ?? []) walk(child, depth + 1);
  };
  walk(rootId, 0);
  return collected;
}

// The ancestor chain of a group, root first, the group itself last — the
// natural breadcrumb for an object reference.
export function groupAncestorPath(
  id: string,
  groups: ReadonlyArray<Pick<ProjectGroupDto, 'id' | 'parentId' | 'name'>>,
): string[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const segments: string[] = [];
  let current = byId.get(id);
  let depth = 0;
  while (current && depth < PROJECT_GROUP_MAX_DEPTH) {
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth += 1;
  }
  return segments;
}

// One rendered row of the group tree: the node, how deep it sits, and what the
// guide lines to its left must draw.
export interface ProjectGroupTreeRow {
  group: ProjectGroupDto;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

// Flattens the tree into the row list a management screen renders: depth-first,
// siblings in stored order, a collapsed branch contributing its own row but none
// of its children. Pure and separate from the component so the order it produces
// — and what a collapse actually hides — is checkable without rendering.
export function buildGroupTreeRows(
  groups: readonly ProjectGroupDto[],
  collapsed: ReadonlySet<string>,
): ProjectGroupTreeRow[] {
  const childrenByParent = new Map<string | null, ProjectGroupDto[]>();
  for (const group of groups) {
    const siblings = childrenByParent.get(group.parentId) ?? [];
    siblings.push(group);
    childrenByParent.set(group.parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
  }

  const rows: ProjectGroupTreeRow[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const group of childrenByParent.get(parentId) ?? []) {
      const expanded = !collapsed.has(group.id);
      const hasChildren = (childrenByParent.get(group.id) ?? []).length > 0;
      rows.push({ group, depth, hasChildren, expanded });
      if (expanded && depth + 1 < PROJECT_GROUP_MAX_DEPTH) {
        walk(group.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return rows;
}
