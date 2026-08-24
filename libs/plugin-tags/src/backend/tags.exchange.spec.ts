import { ExchangeIdMap } from '@makekeeper/backend-core';
import type {
  ExchangeImportContext,
  PrismaTransactionClient,
} from '@makekeeper/backend-core';
import { createTagsExchangeProviders } from './tags.exchange';

// Import-side behavior of the tags section: match-by-name reuse, ref remap
// through the id-map, dropped links for absent targets, duplicate-link guard.

interface FakeTag {
  id: string;
  name: string;
  color: string;
}

interface FakeLink {
  id: string;
  tagId: string;
  ref: string;
}

function makeCtx(
  existingTags: FakeTag[],
  existingLinks: FakeLink[],
  idMap: ExchangeIdMap,
): { ctx: ExchangeImportContext; tags: FakeTag[]; links: FakeLink[] } {
  const tags = [...existingTags];
  const links = [...existingLinks];
  const tx = {
    tag: {
      findFirst: ({ where }: { where: { name: { equals: string } } }) =>
        Promise.resolve(
          tags.find(
            (t) => t.name.toLowerCase() === where.name.equals.toLowerCase(),
          ) ?? null,
        ),
      create: ({ data }: { data: FakeTag }) => {
        tags.push(data);
        return Promise.resolve(data);
      },
    },
    tagLink: {
      findFirst: ({ where }: { where: { tagId: string; ref: string } }) =>
        Promise.resolve(
          links.find((l) => l.tagId === where.tagId && l.ref === where.ref) ??
            null,
        ),
      create: ({ data }: { data: FakeLink }) => {
        links.push(data);
        return Promise.resolve(data);
      },
    },
  } as unknown as PrismaTransactionClient;
  const ctx: ExchangeImportContext = {
    root: { entityType: 'project', entityId: 'p-old' },
    tx,
    scopeId: null,
    locale: 'en',
    selectedSections: new Set(['tags.links']),
    idMap,
    options: {},
    preserveIds: false,
    files: {
      readFile: () => Promise.resolve(null),
      filePath: () => Promise.resolve(null),
      listFiles: () => Promise.resolve([]),
    },
  };
  return { ctx, tags, links };
}

describe('tags.links import', () => {
  const provider = createTagsExchangeProviders(
    // Export path unused in these tests.
    { tagLink: { findMany: () => Promise.resolve([]) } } as never,
  )[0];

  const records = [
    { t: 'tag', id: 'tag-a', name: 'urgent', color: 'red' },
    { t: 'tag', id: 'tag-b', name: '3d-print', color: 'blue' },
    { t: 'link', tagId: 'tag-a', ref: 'mk://projects/project/p-old' },
    { t: 'link', tagId: 'tag-b', ref: 'mk://projects/project/p-old' },
    { t: 'link', tagId: 'tag-a', ref: 'mk://projects/task/t-old' },
  ];

  it('reuses an existing tag by name (color untouched) and creates the missing one', async () => {
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('task', 't-old', 't-new');
    const { ctx, tags, links } = makeCtx(
      [{ id: 'local-urgent', name: 'Urgent', color: 'amber' }],
      [],
      idMap,
    );
    const result = await provider.importSection(records, ctx);
    // One new tag (3d-print) + three links.
    expect(result.created).toBe(4);
    const urgent = tags.find((t) => t.name.toLowerCase() === 'urgent');
    expect(urgent?.color).toBe('amber');
    expect(links.map((l) => l.ref).sort()).toEqual([
      'mk://projects/project/p-new',
      'mk://projects/project/p-new',
      'mk://projects/task/t-new',
    ]);
    expect(links.filter((l) => l.tagId === 'local-urgent')).toHaveLength(2);
  });

  it('drops links whose target did not travel', async () => {
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    // No task mapping — its link must be dropped.
    const { ctx, links } = makeCtx([], [], idMap);
    await provider.importSection(records, ctx);
    expect(links.every((l) => !l.ref.includes('task'))).toBe(true);
  });

  it('skips a link that already exists on the matched tag', async () => {
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('task', 't-old', 't-new');
    const { ctx, links } = makeCtx(
      [{ id: 'local-urgent', name: 'urgent', color: 'red' }],
      [{ id: 'l1', tagId: 'local-urgent', ref: 'mk://projects/project/p-new' }],
      idMap,
    );
    await provider.importSection(records, ctx);
    expect(
      links.filter(
        (l) =>
          l.tagId === 'local-urgent' && l.ref === 'mk://projects/project/p-new',
      ),
    ).toHaveLength(1);
  });
});
