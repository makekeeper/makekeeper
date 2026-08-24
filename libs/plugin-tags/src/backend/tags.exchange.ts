import {
  ExchangeSectionProvider,
  PrismaService,
  generateUuid,
  isExchangeRecord,
  readString,
  exchangeScopeFilter,
  exchangeScopeStamp,
} from '@makekeeper/backend-core';
import { formatObjectRef, parseObjectRef } from '@makekeeper/plugin-contract';

// Exchange section provider of the tags plugin (#62): `tags.links` for both
// entity roots. Runs LAST (`runAfter` everything it might reference): on
// export it selects the TagLinks pointing at any exported entity (matching on
// the fragment-stripped base ref); on import it rebuilds each ref through the
// id-map + `formatObjectRef` — never string surgery — and matches tags
// strictly BY NAME: `@@unique([scopeId, name])` makes that mandatory, the
// local vocabulary's color always wins, only missing tags are created.

export function createTagsExchangeProviders(
  prisma: PrismaService,
): ExchangeSectionProvider[] {
  const linksProvider: ExchangeSectionProvider = {
    sectionKey: 'tags.links',

    async exportSection(ctx) {
      const exportedBases = new Set(ctx.getExportedRefs());
      // Scoped read; filtering happens on parsed base refs, not substrings.
      const links = await prisma.tagLink.findMany({ include: { tag: true } });
      const records: Record<string, unknown>[] = [];
      const tagsSeen = new Set<string>();
      for (const link of links) {
        const parsed = parseObjectRef(link.ref);
        if (!parsed) continue;
        const base = formatObjectRef({
          pluginId: parsed.pluginId,
          entityType: parsed.entityType,
          entityId: parsed.entityId,
        });
        if (!base || !exportedBases.has(base)) continue;
        if (!tagsSeen.has(link.tagId)) {
          tagsSeen.add(link.tagId);
          records.push({
            t: 'tag',
            id: link.tag.id,
            name: link.tag.name,
            color: link.tag.color,
          });
        }
        records.push({ t: 'link', tagId: link.tagId, ref: link.ref });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'link')).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'tag')) continue;
        const oldId = readString(raw, 'id', 100);
        const name = readString(raw, 'name', 100);
        if (!oldId || !name) continue;
        if (!ctx.preserveIds) {
          // Always match-by-name: reuse the local tag (its color untouched).
          const existing = await ctx.tx.tag.findFirst({
            where: {
              name: { equals: name, mode: 'insensitive' },
              ...exchangeScopeFilter(ctx),
            },
          });
          if (existing) {
            ctx.idMap.set('tag', oldId, existing.id);
            continue;
          }
        }
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('tag', oldId, newId);
        await ctx.tx.tag.create({
          data: {
            id: newId,
            name,
            color: readString(raw, 'color', 20) ?? 'slate',
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'link')) continue;
        const oldTagId = readString(raw, 'tagId', 100);
        const oldRef = readString(raw, 'ref', 600);
        if (!oldTagId || !oldRef) continue;
        const tagId = ctx.preserveIds
          ? oldTagId
          : ctx.idMap.translate('tag', oldTagId);
        const parsed = parseObjectRef(oldRef);
        if (!tagId || !parsed) continue;
        const entityId = ctx.preserveIds
          ? parsed.entityId
          : ctx.idMap.translate(parsed.entityType, parsed.entityId);
        // A link whose target did not travel is dropped, never dangled.
        if (!entityId) continue;
        const newRef = formatObjectRef({ ...parsed, entityId });
        if (!newRef) continue;
        // The tag may pre-exist with this exact link (re-import into the same
        // vocabulary) — the (tagId, ref) unique pair must not blow the run.
        const existing = await ctx.tx.tagLink.findFirst({
          where: { tagId, ref: newRef },
        });
        if (existing) continue;
        await ctx.tx.tagLink.create({
          data: {
            id: generateUuid(),
            tagId,
            ref: newRef,
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      return { created };
    },
  };

  return [linksProvider];
}
