import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ExchangeSectionProvider,
  PluginI18nService,
  PrismaService,
  generateUuid,
  isExchangeRecord,
  readNumber,
  readOptionalString,
  readString,
  exchangeScopeFilter,
  exchangeScopeStamp,
} from '@makekeeper/backend-core';
import { formatObjectRef, resolveEntityId } from '@makekeeper/plugin-contract';

// Exchange section provider of the storages plugin (#62): the `storage` root
// section — the picked storage's ENTIRE subtree (children recursively) with
// grid geometry. Import target is an option: a new root storage, or a child
// of an existing storage (optionally at a grid cell). A name collision at the
// target level gets an i18n-keyed suffix instead of silently doubling names.

function storageRef(id: string): string | null {
  return formatObjectRef({
    pluginId: 'storages',
    entityType: 'storage',
    entityId: id,
  });
}

export function createStoragesExchangeProviders(
  prisma: PrismaService,
  i18n: PluginI18nService,
): ExchangeSectionProvider[] {
  const structureProvider: ExchangeSectionProvider = {
    sectionKey: 'storages.structure',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'storages',
            entityType: 'storage',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      const root = await prisma.storage.findUnique({
        where: { id: resolved.id },
      });
      if (!root) throw new NotFoundException('exchange.errors.rootNotFound');

      // Breadth-first subtree walk — parents always precede children in the
      // record stream, so the import can create rows in order.
      const records: Record<string, unknown>[] = [];
      let frontier = [root];
      while (frontier.length > 0) {
        for (const storage of frontier) {
          const ref = storageRef(storage.id);
          if (ref) ctx.addExportedRef(ref);
          records.push({
            t: 'storage',
            id: storage.id,
            // The exported root's parent linkage is dropped — it re-anchors at
            // the import target instead.
            parentId: storage.id === root.id ? null : storage.parentId,
            parentRow: storage.id === root.id ? null : storage.parentRow,
            parentCol: storage.id === root.id ? null : storage.parentCol,
            name: storage.name,
            location: storage.location,
            gridRows: storage.gridRows,
            gridCols: storage.gridCols,
            gridSpans: storage.gridSpans,
          });
        }
        frontier = await prisma.storage.findMany({
          where: { parentId: { in: frontier.map((s) => s.id) } },
        });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'storage')).length,
      };
    },

    async importSection(records, ctx) {
      // Import target: absent → a new root storage. Scoped read validates the
      // target belongs to the caller.
      const targetId =
        typeof ctx.options['targetStorageId'] === 'string'
          ? ctx.options['targetStorageId']
          : null;
      const targetRow =
        typeof ctx.options['targetRow'] === 'number'
          ? ctx.options['targetRow']
          : null;
      const targetCol =
        typeof ctx.options['targetCol'] === 'number'
          ? ctx.options['targetCol']
          : null;
      let target: { id: string } | null = null;
      if (targetId && !ctx.preserveIds) {
        target = await ctx.tx.storage.findFirst({
          where: { id: targetId, ...exchangeScopeFilter(ctx) },
        });
        if (!target)
          throw new BadRequestException('exchange.errors.rootNotFound');
      }

      let created = 0;
      let importedRootRef: string | undefined;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'storage')) continue;
        const oldId = readString(raw, 'id', 100);
        let name = readString(raw, 'name', 300);
        if (!oldId || !name) continue;
        const oldParentId = readOptionalString(raw, 'parentId', 100);
        const isSubtreeRoot = oldParentId === null;
        const parentId = ctx.preserveIds
          ? oldParentId
          : isSubtreeRoot
            ? (target?.id ?? null)
            : ctx.idMap.translate('storage', oldParentId);
        // A child whose parent vanished from the stream would dangle — skip.
        if (!isSubtreeRoot && !parentId && !ctx.preserveIds) continue;

        if (isSubtreeRoot && !ctx.preserveIds) {
          // De-collide the imported root's name at its target level.
          const sibling = await ctx.tx.storage.findFirst({
            where: {
              parentId: parentId ?? null,
              name: { equals: name, mode: 'insensitive' },
              ...exchangeScopeFilter(ctx),
            },
          });
          if (sibling) {
            name =
              `${name} ${i18n.t('storages.exchange.importedSuffix', {}, ctx.locale)}`.slice(
                0,
                300,
              );
          }
        }

        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('storage', oldId, newId);
        await ctx.tx.storage.create({
          data: {
            id: newId,
            name,
            parentId,
            location: readOptionalString(raw, 'location', 500),
            gridRows: readNumber(raw, 'gridRows'),
            gridCols: readNumber(raw, 'gridCols'),
            gridSpans: readOptionalString(raw, 'gridSpans', 20_000),
            parentRow:
              isSubtreeRoot && !ctx.preserveIds
                ? targetRow
                : readNumber(raw, 'parentRow'),
            parentCol:
              isSubtreeRoot && !ctx.preserveIds
                ? targetCol
                : readNumber(raw, 'parentCol'),
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
        if (isSubtreeRoot) importedRootRef = storageRef(newId) ?? undefined;
      }
      return { created, rootRef: importedRootRef };
    },
  };

  return [structureProvider];
}
