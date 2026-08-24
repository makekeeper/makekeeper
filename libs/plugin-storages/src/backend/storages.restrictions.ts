import { PrismaService } from '@makekeeper/backend-core';
import {
  ModelConstraintMap,
  RestrictableResourceOption,
  ScopeRestrictionDescriptor,
} from '@makekeeper/plugin-contract';

// The storages plugin announces "restrict a shared scope to specific storage
// subtree(s)". A selected storage implies all of its descendants (same
// expansion the components listing uses), and components narrow to whatever
// sits inside the selected subtrees.
export function createStoragesRestriction(
  prisma: PrismaService,
): ScopeRestrictionDescriptor {
  return {
    pluginId: 'storages',
    resourceKey: 'storage',
    labelKey: 'storages.restrictions.byStorage',

    async listOptions(
      ownerScopeId: string,
    ): Promise<RestrictableResourceOption[]> {
      const storages = await prisma.storage.findMany({
        where: { scopeId: ownerScopeId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, parentId: true },
      });
      // Indent children under their parents so the pick list reads as a tree.
      const byParent = new Map<string | null, { id: string; name: string }[]>();
      for (const storage of storages) {
        const list = byParent.get(storage.parentId) ?? [];
        list.push({ id: storage.id, name: storage.name });
        byParent.set(storage.parentId, list);
      }
      const options: RestrictableResourceOption[] = [];
      const walk = (parentId: string | null, depth: number): void => {
        for (const node of byParent.get(parentId) ?? []) {
          options.push({
            id: node.id,
            label: `${'— '.repeat(depth)}${node.name}`,
          });
          walk(node.id, depth + 1);
        }
      };
      walk(null, 0);
      return options;
    },

    async buildModelConstraints(
      ownerScopeId: string,
      selectedIds: string[],
    ): Promise<ModelConstraintMap> {
      const storages = await prisma.storage.findMany({
        where: { scopeId: ownerScopeId },
        select: { id: true, parentId: true },
      });
      const childrenOf = new Map<string, string[]>();
      for (const storage of storages) {
        if (!storage.parentId) continue;
        const list = childrenOf.get(storage.parentId) ?? [];
        list.push(storage.id);
        childrenOf.set(storage.parentId, list);
      }
      const known = new Set(storages.map((storage) => storage.id));
      const expanded = new Set<string>();
      const expand = (id: string): void => {
        if (!known.has(id) || expanded.has(id)) return;
        expanded.add(id);
        for (const childId of childrenOf.get(id) ?? []) expand(childId);
      };
      for (const id of selectedIds) expand(id);
      const inSubtrees = { in: Array.from(expanded) };
      return {
        Storage: { id: inSubtrees },
        Component: { storageId: inSubtrees },
      };
    },
  };
}
