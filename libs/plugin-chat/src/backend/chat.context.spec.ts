import { ChatService } from './chat.service';

// What the chat says it is working on (#129, reshaped by #130). The panel states
// this before a message is sent, so the answer must come from the same rules the
// turn itself applies: the scope the client sends (validated here, never
// re-derived), the page object named by the plugin that owns it, and the owner
// that would take an attached file.

const PROJECT_REF = 'mk://projects/project/p1';
const CELL_REF = 'mk://storages/storage/st1#B1';
const ITEM_REF = 'mk://inventory/component/c1';

const makeService = (
  projects: Record<string, { title: string }>,
  objects: Record<string, { displayName: string; breadcrumb?: string }> = {},
  // Plugins that claim files for an object they own — the inventory item is the
  // real case (#130); everything else answers null and the file goes to the
  // project instead.
  fileOwners: Record<string, string> = {},
): ChatService => {
  const prisma = {
    project: {
      findUnique: ({
        where,
      }: {
        where: { id: string };
      }): Promise<{ id: string; title: string } | null> => {
        const found = projects[where.id];
        return Promise.resolve(found ? { id: where.id, ...found } : null);
      },
    },
  };
  // Stands in for the registry the `resolve_object_ref` tool uses: a plugin
  // names its own objects, and an unregistered or invisible one resolves to
  // nothing rather than to a guess.
  const agentRegistry = {
    resolveObjectRef: (ref: string) => {
      const found = objects[ref];
      return Promise.resolve(
        found ? { ref, exists: true, ...found } : { ref, exists: false },
      );
    },
  };
  const capabilities = {
    getCapability: (id: string) =>
      id === 'attachment-target.inventory'
        ? {
            describeAttachmentTarget: (ref: string) =>
              Promise.resolve(
                fileOwners[ref] ? { name: fileOwners[ref] } : null,
              ),
            adoptAttachments: () => Promise.resolve(),
          }
        : null,
  };
  // Only the collaborators this path touches are real: the rest of the service
  // is untouched by it and must not be stood up to ask one question of it.
  return new ChatService(
    prisma as never,
    agentRegistry as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    capabilities as never,
  );
};

describe('ChatService chat context', () => {
  describe('the project half — the scope of the next turn', () => {
    // The scope is the client's answer: the store walks the rule (a visited
    // project page overrides, a hand-picked project holds until the next visit)
    // and sends the result. The line names that, and sendMessage stamps it —
    // one authority, so the two cannot part ways.
    it('names the project the client carries as the scope', async () => {
      const service = makeService({ p1: { title: 'Workbench lamp' } });

      const context = await service.resolveChatContext([CELL_REF], 'p1');

      expect(context.project).toEqual({ id: 'p1', name: 'Workbench lamp' });
    });

    // Re-deriving the scope from the page here is what made "No project" on a
    // project's own page a no-op: the pick was discarded and the line
    // re-rendered the project it had just been told to drop.
    it('does not let the page ORef override the scope the client picked', async () => {
      const service = makeService({
        p1: { title: 'Workbench lamp' },
        p2: { title: 'Old build' },
      });

      const context = await service.resolveChatContext([PROJECT_REF], 'p2');

      expect(context.project).toEqual({ id: 'p2', name: 'Old build' });
    });

    it('reports no project when the client picked none, on a project page too', async () => {
      const service = makeService({ p1: { title: 'Workbench lamp' } });

      const context = await service.resolveChatContext([PROJECT_REF], null);

      expect(context.project).toBeNull();
    });

    // The name is read through the scoped client, so an id the caller cannot
    // see resolves to no row. "Files stay in the chat" is then not a fallback
    // but the truth: the same scoped write would refuse to file them there.
    // It is also the signal the client drops its stale stickiness on.
    it('says nothing about a project the caller cannot see', async () => {
      const service = makeService({});

      const context = await service.resolveChatContext([PROJECT_REF], 'p1');

      expect(context.project).toBeNull();
    });

    // "No project" is a real answer the user can choose, not a missing one.
    it('reports no project when the client carries none', async () => {
      const service = makeService({ p1: { title: 'Workbench lamp' } });

      const context = await service.resolveChatContext([CELL_REF], null);

      expect(context.project).toBeNull();
    });
  });

  describe('the page half — what the chat is looking at', () => {
    // This is the half that follows navigation across the WHOLE app: any view
    // that publishes an ORef gets named, not only project pages.
    it('names the page object through its owning plugin', async () => {
      const service = makeService(
        {},
        {
          [CELL_REF]: {
            displayName: 'B1',
            breadcrumb: 'Office / Working Table',
          },
        },
      );

      const context = await service.resolveChatContext([CELL_REF], null);

      expect(context.page).toEqual({
        name: 'B1',
        breadcrumb: 'Office / Working Table',
      });
    });

    // A view publishes its selection most-specific-first, and the line has room
    // for one object.
    it('takes the first ref that still resolves', async () => {
      const service = makeService(
        {},
        {
          [PROJECT_REF]: { displayName: 'Workbench lamp' },
        },
      );

      const context = await service.resolveChatContext(
        [CELL_REF, PROJECT_REF],
        null,
      );

      expect(context.page).toEqual({
        name: 'Workbench lamp',
        breadcrumb: null,
      });
    });

    it('reports no page object when the screen published none', async () => {
      const service = makeService({});

      const context = await service.resolveChatContext([], null);

      expect(context.page).toBeNull();
      expect(context.project).toBeNull();
    });
  });

  // The half #130 added: the panel must be able to say where a file goes before
  // it is sent, and the answer stopped being "the project" the moment an object
  // on screen could own pictures of its own.
  describe('the filing half — who would take a file', () => {
    it('names the page object when its plugin claims files for it', async () => {
      const service = makeService(
        { p1: { title: 'Workbench lamp' } },
        { [ITEM_REF]: { displayName: 'BC547' } },
        { [ITEM_REF]: 'BC547' },
      );

      const context = await service.resolveChatContext([ITEM_REF], 'p1');

      expect(context.filing).toEqual({ name: 'BC547' });
      // The scope is unaffected: the turn still happens inside the project the
      // user is working in, only the bytes belong to the item.
      expect(context.project).toEqual({ id: 'p1', name: 'Workbench lamp' });
    });

    // A storage cell is referenceable but owns no files, and its plugin
    // registers nothing — which is how the file falls back to the project.
    it('falls back to the project when nothing on screen claims files', async () => {
      const service = makeService(
        { p1: { title: 'Workbench lamp' } },
        { [CELL_REF]: { displayName: 'B1' } },
      );

      const context = await service.resolveChatContext([CELL_REF], 'p1');

      expect(context.filing).toEqual({ name: 'Workbench lamp' });
    });

    // Nothing claims it and there is no scope either: the file has nowhere to
    // go but the conversation, and the panel says so rather than implying a
    // place.
    it('names nobody when there is neither an owner nor a project', async () => {
      const service = makeService({});

      const context = await service.resolveChatContext([CELL_REF], null);

      expect(context.filing).toBeNull();
    });

    // An owner that no longer resolves (the item was deleted while the panel
    // was open) is not an owner — the answer must not name a gone object.
    it('ignores an owner that no longer names anything', async () => {
      const service = makeService({ p1: { title: 'Workbench lamp' } }, {}, {});

      const context = await service.resolveChatContext([ITEM_REF], 'p1');

      expect(context.filing).toEqual({ name: 'Workbench lamp' });
    });
  });
});
