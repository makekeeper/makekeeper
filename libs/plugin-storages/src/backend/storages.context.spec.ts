import { PluginI18nService } from '@makekeeper/backend-core';
import { createStoragesPageContextResolver } from './storages.context';
import { StoragesService } from './storages.service';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

// Real resolver so the DB-derived params (path, cell address) render inside the
// localized template. Default locale is 'en', so assertions below are on the
// English page-context text.
const i18n = new PluginI18nService();
i18n.registerBundle({ en, ru });

// Covers the server-side page-context resolver (#15): route ids in → exact,
// DB-derived description out. This is the text the agent actually receives, so
// the assertions here ARE the contract for "which cell is open".
describe('storages page-context resolver', () => {
  // Office (root) → Working Table (grid 3×4). Working Table sits loose in Office
  // (no parent cell); a nested box occupies Working Table's cell A2 (row 1, col 0).
  const storages = [
    {
      id: 'office',
      name: 'Office',
      parentId: null,
      parentRow: null,
      parentCol: null,
    },
    {
      id: 'table',
      name: 'Working Table',
      parentId: 'office',
      parentRow: null,
      parentCol: null,
    },
    { id: 'box', name: 'Box', parentId: 'table', parentRow: 1, parentCol: 0 },
  ];

  const resolver = createStoragesPageContextResolver(
    {
      findAll: () => Promise.resolve(storages),
    } as unknown as StoragesService,
    i18n,
  );

  const ctx = (query: Record<string, string>) => ({
    pluginId: 'storages',
    query,
  });

  it('resolves storage + open cell into the exact address the UI shows', async () => {
    const text = await resolver(
      ctx({ storageId: 'table', row: '0', col: '1' }),
    );
    expect(text).toContain('«Office / Working Table»');
    expect(text).toContain('storageId: table');
    expect(text).toContain('«B1»');
    // The resolver must never leak raw row/col numbers for the LLM to re-derive.
    expect(text).not.toContain('строка 0');
    expect(text).not.toContain('колонка 1');
  });

  it('maps (row 0, col 0) to A1 — the exact bug from the ticket', async () => {
    const text = await resolver(
      ctx({ storageId: 'table', row: '0', col: '0' }),
    );
    expect(text).toContain('«A1»');
  });

  it('tags nested containers with their placement cell in the path', async () => {
    const text = await resolver(ctx({ storageId: 'box', row: '0', col: '0' }));
    expect(text).toContain('«Office / Working Table / Box (A2)»');
  });

  it('reports storage-only context when no cell is open', async () => {
    const text = await resolver(ctx({ storageId: 'table' }));
    expect(text).toContain('«Office / Working Table»');
    expect(text).toContain('No specific grid cell is open');
  });

  it('returns null for an unknown storage or missing id', async () => {
    expect(
      await resolver(ctx({ storageId: 'nope', row: '0', col: '0' })),
    ).toBeNull();
    expect(await resolver(ctx({}))).toBeNull();
  });

  it('ignores malformed row/col instead of inventing a cell', async () => {
    const text = await resolver(
      ctx({ storageId: 'table', row: 'x', col: '1' }),
    );
    expect(text).toContain('No specific grid cell is open');
  });
});
