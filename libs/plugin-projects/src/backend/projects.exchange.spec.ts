import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { ExchangeIdMap } from '@makekeeper/backend-core';
import type {
  AttachmentStorageService,
  ExchangeExportContext,
  ExchangeImportContext,
  PluginI18nService,
  PrismaService,
  PrismaTransactionClient,
} from '@makekeeper/backend-core';
import { createProjectsExchangeProviders } from './projects.exchange';
import { defaultProjectGroupId } from './project-groups.util';

// Projects exchange providers: root export with an embedded cover snapshot,
// fresh-id import registered in the id-map, cover re-import through the
// path-based file source, and task link remapping/dropping.

type MockCall = { data: Record<string, unknown> };

// The providers resolve the default group's name through i18n; the key itself
// is answer enough for a unit test.
const i18nStub = {
  t: (key: string) => key,
} as unknown as PluginI18nService;

// The transaction delegates every project import touches to land the project in
// the target scope's default group (#286).
function makeGroupTx(): {
  projectGroup: { findUnique: Mock; create: Mock };
} {
  return {
    projectGroup: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn((call: MockCall) => Promise.resolve(call.data)),
    },
  };
}

function makeExportCtx(selected: string[]): {
  ctx: ExchangeExportContext;
  refs: string[];
  putFileFromPath: Mock;
} {
  const refs: string[] = [];
  const putFileFromPath = vi.fn(() => Promise.resolve());
  const ctx: ExchangeExportContext = {
    root: { entityType: 'project', entityId: 'p-old' },
    locale: 'en',
    selectedSections: new Set(selected),
    includeSecrets: false,
    addExportedRef: (ref) => {
      refs.push(ref);
    },
    getExportedRefs: () => refs,
    files: {
      putFile: () => Promise.resolve(),
      putFileFromPath,
    },
  };
  return { ctx, refs, putFileFromPath };
}

function makeImportCtx(
  tx: unknown,
  idMap: ExchangeIdMap,
  filePath: (fileId: string) => Promise<string | null> = () =>
    Promise.resolve(null),
): ExchangeImportContext {
  return {
    root: { entityType: 'project', entityId: 'p-old' },
    tx: tx as PrismaTransactionClient,
    scopeId: null,
    locale: 'en',
    selectedSections: new Set(['projects.project', 'projects.tasks']),
    idMap,
    options: {},
    preserveIds: false,
    files: {
      readFile: () => Promise.resolve(null),
      filePath,
      listFiles: () => Promise.resolve([]),
    },
  };
}

const baseProject = {
  id: 'p-old',
  title: 'Robot arm',
  description: null,
  status: 'ACTIVE',
  startDate: null,
  dueDate: null,
  position: 2,
  budgetPlanned: 150,
  budgetCurrency: 'EUR',
  coverAttachmentId: null as string | null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('projects.project provider', () => {
  it('exports the project row with an embedded cover when the file exists', async () => {
    const prisma = {
      project: {
        findUnique: () =>
          Promise.resolve({ ...baseProject, coverAttachmentId: 'att-1' }),
      },
      attachment: {
        findUnique: () =>
          Promise.resolve({
            id: 'att-1',
            mimeType: 'image/png',
            filename: 'cover.png',
            sizeBytes: 42,
          }),
      },
    } as unknown as PrismaService;
    const attachments = {
      resolveExistingFile: () =>
        Promise.resolve({
          path: '/uploads/2026/att-1.png',
          mimeType: 'image/png',
          sizeBytes: 42,
        }),
    } as unknown as AttachmentStorageService;
    const [provider] = createProjectsExchangeProviders(
      prisma,
      attachments,
      i18nStub,
    );
    const { ctx, refs, putFileFromPath } = makeExportCtx(['projects.project']);
    const { records } = await provider.exportSection(ctx);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      t: 'project',
      id: 'p-old',
      title: 'Robot arm',
      status: 'ACTIVE',
      cover: {
        id: 'att-1',
        mimeType: 'image/png',
        filename: 'cover.png',
        sizeBytes: 42,
      },
    });
    expect(putFileFromPath).toHaveBeenCalledWith(
      'att-1',
      '/uploads/2026/att-1.png',
    );
    expect(refs).toContain('mk://projects/project/p-old');
  });

  it('omits the cover when the attachment file is gone', async () => {
    const prisma = {
      project: {
        findUnique: () =>
          Promise.resolve({ ...baseProject, coverAttachmentId: 'att-1' }),
      },
      attachment: {
        findUnique: () =>
          Promise.resolve({
            id: 'att-1',
            mimeType: 'image/png',
            filename: 'cover.png',
            sizeBytes: 42,
          }),
      },
    } as unknown as PrismaService;
    const attachments = {
      resolveExistingFile: () => Promise.resolve(null),
    } as unknown as AttachmentStorageService;
    const [provider] = createProjectsExchangeProviders(
      prisma,
      attachments,
      i18nStub,
    );
    const { ctx, putFileFromPath } = makeExportCtx(['projects.project']);
    const { records } = await provider.exportSection(ctx);
    expect((records[0] as Record<string, unknown>)['cover']).toBeUndefined();
    expect(putFileFromPath).not.toHaveBeenCalled();
  });

  it('imports under a fresh id, registers it in the id-map and returns the root ref', async () => {
    const created: MockCall[] = [];
    const tx = {
      ...makeGroupTx(),
      project: {
        create: vi.fn((call: MockCall) => {
          created.push(call);
          return Promise.resolve(call.data);
        }),
      },
    };
    const idMap = new ExchangeIdMap();
    const [provider] = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    );
    const result = await provider.importSection(
      [{ t: 'project', id: 'p-old', title: 'Robot arm', position: 2 }],
      makeImportCtx(tx, idMap),
    );
    expect(result.created).toBe(1);
    const newId = idMap.get('project', 'p-old');
    expect(newId).not.toBeNull();
    expect(newId).not.toBe('p-old');
    expect(created[0].data).toMatchObject({
      id: newId,
      title: 'Robot arm',
      position: 2,
      scopeId: null,
    });
    expect(result.rootRef).toBe(`mk://projects/project/${newId ?? ''}`);
  });

  it('re-imports the cover through filePath + importFileFromPath', async () => {
    const attachmentCreates: MockCall[] = [];
    const projectUpdates: MockCall[] = [];
    const tx = {
      ...makeGroupTx(),
      project: {
        create: vi.fn((call: MockCall) => Promise.resolve(call.data)),
        update: vi.fn((call: MockCall) => {
          projectUpdates.push(call);
          return Promise.resolve(call.data);
        }),
      },
      attachment: {
        create: vi.fn((call: MockCall) => {
          attachmentCreates.push(call);
          return Promise.resolve(call.data);
        }),
      },
    };
    const importFileFromPath = vi.fn(() =>
      Promise.resolve({ relPath: '2026/new-att.png', sizeBytes: 42 }),
    );
    const attachments = {
      importFileFromPath,
    } as unknown as AttachmentStorageService;
    const [provider] = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      attachments,
      i18nStub,
    );
    const idMap = new ExchangeIdMap();
    await provider.importSection(
      [
        {
          t: 'project',
          id: 'p-old',
          title: 'Robot arm',
          cover: {
            id: 'att-1',
            mimeType: 'image/png',
            filename: 'cover.png',
            sizeBytes: 42,
          },
        },
      ],
      makeImportCtx(tx, idMap, (fileId) =>
        Promise.resolve(fileId === 'att-1' ? '/extract/att-1' : null),
      ),
    );
    expect(importFileFromPath).toHaveBeenCalledWith(
      expect.stringMatching(/^att_/),
      'image/png',
      'cover.png',
      '/extract/att-1',
    );
    expect(attachmentCreates[0].data).toMatchObject({
      storagePath: '2026/new-att.png',
      mimeType: 'image/png',
      sizeBytes: 42,
      projectId: idMap.get('project', 'p-old'),
    });
    expect(projectUpdates[0].data).toEqual({
      coverAttachmentId: attachmentCreates[0].data['id'],
    });
  });
});

describe('projects.tasks provider', () => {
  const taskRecords = [
    { t: 'task', id: 't-old', projectId: 'p-old', title: 'Solder board' },
    { t: 'taskComponent', taskId: 't-old', componentId: 'c-old', quantity: 3 },
    { t: 'taskOrder', taskId: 't-old', orderId: 'o-old', isDone: true },
  ];

  function makeTx(): {
    tx: unknown;
    tasks: MockCall[];
    taskComponents: MockCall[];
    taskOrders: MockCall[];
  } {
    const tasks: MockCall[] = [];
    const taskComponents: MockCall[] = [];
    const taskOrders: MockCall[] = [];
    const tx = {
      task: {
        create: vi.fn((call: MockCall) => {
          tasks.push(call);
          return Promise.resolve(call.data);
        }),
      },
      taskComponent: {
        create: vi.fn((call: MockCall) => {
          taskComponents.push(call);
          return Promise.resolve(call.data);
        }),
      },
      taskOrderDependency: {
        create: vi.fn((call: MockCall) => {
          taskOrders.push(call);
          return Promise.resolve(call.data);
        }),
      },
    };
    return { tx, tasks, taskComponents, taskOrders };
  }

  it('remaps task ids and drops order links whose order did not travel', async () => {
    const { tx, tasks, taskComponents, taskOrders } = makeTx();
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('component', 'c-old', 'c-new');
    // No 'order' mapping — logistics.orders was not selected.
    const provider = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    )[1];
    const result = await provider.importSection(
      taskRecords,
      makeImportCtx(tx, idMap),
    );
    expect(tasks[0].data).toMatchObject({
      projectId: 'p-new',
      title: 'Solder board',
      priority: 'MEDIUM',
    });
    const newTaskId = idMap.get('task', 't-old');
    expect(newTaskId).not.toBeNull();
    expect(newTaskId).not.toBe('t-old');
    expect(taskComponents[0].data).toMatchObject({
      taskId: newTaskId,
      componentId: 'c-new',
      quantity: 3,
    });
    expect(taskOrders).toHaveLength(0);
    // Task + component link travelled, the order link was dropped.
    expect(result.created).toBe(2);
  });

  it('keeps order links once the order id is mapped', async () => {
    const { tx, taskOrders } = makeTx();
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('component', 'c-old', 'c-new');
    idMap.set('order', 'o-old', 'o-new');
    const provider = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    )[1];
    await provider.importSection(taskRecords, makeImportCtx(tx, idMap));
    expect(taskOrders[0].data).toMatchObject({
      taskId: idMap.get('task', 't-old'),
      orderId: 'o-new',
      isDone: true,
    });
  });

  it('exports link rows only for selected sibling sections', async () => {
    const prisma = {
      task: {
        findMany: () =>
          Promise.resolve([
            {
              id: 't-old',
              projectId: 'p-old',
              title: 'Solder board',
              description: null,
              isCompleted: false,
              dueDate: null,
              priority: 'HIGH',
              createdAt: new Date('2026-01-02T00:00:00.000Z'),
              components: [
                { componentId: 'c-old', quantity: 3, isDone: false },
              ],
              orders: [{ orderId: 'o-old', isDone: true }],
            },
          ]),
      },
    } as unknown as PrismaService;
    const provider = createProjectsExchangeProviders(
      prisma,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    )[1];
    // inventory.components selected, logistics.orders NOT selected.
    const { ctx, refs } = makeExportCtx([
      'projects.tasks',
      'inventory.components',
    ]);
    const { records } = await provider.exportSection(ctx);
    const kinds = records.map((r) => (r as Record<string, unknown>)['t']);
    expect(kinds).toEqual(['task', 'taskComponent']);
    expect(refs).toContain('mk://projects/task/t-old');
  });
});

// The folder a project lives in travels with it (#287): the chain is exported
// root-first by name, re-created in the target scope on import, and an archive
// that names a group nobody kept falls back to General instead of failing.
describe('projects.project provider — group chain', () => {
  const groups = [
    {
      id: 'g-root',
      name: 'Hardware',
      parentId: null,
      position: 0,
      isDefault: false,
    },
    {
      id: 'g-leaf',
      name: 'Boards',
      parentId: 'g-root',
      position: 1,
      isDefault: false,
    },
  ];

  function exportPrisma() {
    return {
      project: {
        findUnique: () =>
          Promise.resolve({ ...baseProject, groupId: 'g-leaf' }),
      },
      projectGroup: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(groups.find((g) => g.id === where.id) ?? null),
      },
    } as unknown as PrismaService;
  }

  it('exports the project group and every group above it, root first', async () => {
    const [provider] = createProjectsExchangeProviders(
      exportPrisma(),
      {} as unknown as AttachmentStorageService,
      i18nStub,
    );
    const { ctx } = makeExportCtx(['projects.project']);
    const { records } = await provider.exportSection(ctx);
    expect(records[0]).toMatchObject({ t: 'project', groupId: 'g-leaf' });
    expect(records.slice(1)).toEqual([
      {
        t: 'projectGroup',
        id: 'g-root',
        name: 'Hardware',
        parentId: null,
        position: 0,
        isDefault: false,
      },
      {
        t: 'projectGroup',
        id: 'g-leaf',
        name: 'Boards',
        parentId: 'g-root',
        position: 1,
        isDefault: false,
      },
    ]);
  });

  // The archive's ids never travel: an import matches by name under the parent
  // it rebuilt, so importing the same project twice reuses the folders.
  function importTx(
    existing: Array<{ id: string; name: string; parentId: string | null }>,
  ) {
    const created: MockCall[] = [];
    const projects: MockCall[] = [];
    const rows = [...existing];
    const tx = {
      projectGroup: {
        findMany: ({ where }: { where: { parentId: string | null } }) =>
          Promise.resolve(rows.filter((r) => r.parentId === where.parentId)),
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
        create: vi.fn((call: MockCall) => {
          created.push(call);
          const row = {
            id: String(call.data['id']),
            name: String(call.data['name']),
            parentId: (call.data['parentId'] as string | null) ?? null,
          };
          rows.push(row);
          return Promise.resolve(row);
        }),
      },
      project: {
        create: vi.fn((call: MockCall) => {
          projects.push(call);
          return Promise.resolve(call.data);
        }),
      },
    };
    return { tx, created, projects, rows };
  }

  const archive = [
    { t: 'project', id: 'p-old', title: 'Robot arm', groupId: 'g-leaf' },
    {
      t: 'projectGroup',
      id: 'g-root',
      name: 'Hardware',
      parentId: null,
      position: 0,
    },
    {
      t: 'projectGroup',
      id: 'g-leaf',
      name: 'Boards',
      parentId: 'g-root',
      position: 1,
    },
  ];

  it('re-creates the chain in the target scope and files the project in its leaf', async () => {
    const { tx, created, projects } = importTx([]);
    const [provider] = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    );
    await provider.importSection(
      archive,
      makeImportCtx(tx, new ExchangeIdMap()),
    );
    expect(created.map((call) => call.data['name'])).toEqual([
      'Hardware',
      'Boards',
    ]);
    // Fresh ids, parented to the group created one level up, and never flagged
    // as the scope's default.
    expect(created[0].data['parentId']).toBeNull();
    expect(created[1].data['parentId']).toBe(created[0].data['id']);
    expect(created.every((call) => call.data['isDefault'] === false)).toBe(
      true,
    );
    expect(projects[0].data['groupId']).toBe(created[1].data['id']);
  });

  it('reuses a group that is already there, matching the name case-insensitively', async () => {
    const { tx, created, projects } = importTx([
      { id: 'existing-root', name: 'hardware', parentId: null },
    ]);
    const [provider] = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    );
    await provider.importSection(
      archive,
      makeImportCtx(tx, new ExchangeIdMap()),
    );
    expect(created.map((call) => call.data['name'])).toEqual(['Boards']);
    expect(created[0].data['parentId']).toBe('existing-root');
    expect(projects[0].data['groupId']).toBe(created[0].data['id']);
  });

  it('falls back to General when the archive carries no group', async () => {
    const { tx, projects } = importTx([]);
    const [provider] = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    );
    await provider.importSection(
      [{ t: 'project', id: 'p-old', title: 'Robot arm' }],
      makeImportCtx(tx, new ExchangeIdMap()),
    );
    // The default group's id is derived from the scope, not minted.
    expect(projects[0].data['groupId']).toBe(defaultProjectGroupId(null));
  });
});

// An archive's default group is the SOURCE scope's General; the target scope
// already has one, so the chain must continue from it rather than plant a
// second root under the archive's (English) name.
describe('projects.project provider — the archived default group', () => {
  it('maps the archive General onto the target scope default', async () => {
    const created: MockCall[] = [];
    const projects: MockCall[] = [];
    const rows: Array<{
      id: string;
      name: string;
      parentId: string | null;
    }> = [];
    const tx = {
      projectGroup: {
        findMany: ({ where }: { where: { parentId: string | null } }) =>
          Promise.resolve(rows.filter((r) => r.parentId === where.parentId)),
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
        create: vi.fn((call: MockCall) => {
          created.push(call);
          const row = {
            id: String(call.data['id']),
            name: String(call.data['name']),
            parentId: (call.data['parentId'] as string | null) ?? null,
          };
          rows.push(row);
          return Promise.resolve(row);
        }),
      },
      project: {
        create: vi.fn((call: MockCall) => {
          projects.push(call);
          return Promise.resolve(call.data);
        }),
      },
    };
    const [provider] = createProjectsExchangeProviders(
      {} as unknown as PrismaService,
      {} as unknown as AttachmentStorageService,
      i18nStub,
    );
    await provider.importSection(
      [
        { t: 'project', id: 'p-old', title: 'Robot arm', groupId: 'g-sub' },
        {
          t: 'projectGroup',
          id: 'g-gen',
          name: 'General',
          parentId: null,
          isDefault: true,
        },
        {
          t: 'projectGroup',
          id: 'g-sub',
          name: 'Boards',
          parentId: 'g-gen',
          position: 0,
        },
      ],
      makeImportCtx(tx, new ExchangeIdMap()),
    );
    // Only the subgroup is minted; its parent is the derived default id.
    expect(created.map((call) => call.data['name'])).toEqual([
      'General',
      'Boards',
    ]);
    expect(created[0].data['id']).toBe(defaultProjectGroupId(null));
    expect(created[1].data['parentId']).toBe(defaultProjectGroupId(null));
    expect(projects[0].data['groupId']).toBe(created[1].data['id']);
  });
});
