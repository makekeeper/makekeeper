import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AttachmentStorageService } from './attachment-storage.service';
import { RequestContextService } from './request-context.service';

// Owner vs uploader (#125). A file belongs to the thing it was filed under —
// its project, its component — and only a file with no parent belongs to
// whoever uploaded it. Those are two different questions about one row, so they
// are two different columns: `scopeId` (stamped by the scope policy, the only
// thing visibility consults) and `uploadedByUserId` (attribution, recorded
// here). This spec covers the half this service owns.

const makeDeps = (root: string) => {
  const created: Record<string, unknown>[] = [];
  const updated: { where: unknown; data: Record<string, unknown> }[] = [];
  const prisma = {
    attachment: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ ...data });
      },
      updateMany: (args: { where: unknown; data: Record<string, unknown> }) => {
        updated.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return { created, updated, prisma, config: { getUploadsRoot: () => root } };
};

describe('AttachmentStorageService ownership', () => {
  let root: string;
  let deps: ReturnType<typeof makeDeps>;
  let requestContext: RequestContextService;
  let service: AttachmentStorageService;

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'mk-ownership-'));
    deps = makeDeps(root);
    requestContext = new RequestContextService();
    service = new AttachmentStorageService(
      deps.prisma as never,
      deps.config as never,
      requestContext,
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const save = (owner: Record<string, unknown>): Promise<unknown> =>
    service.saveBuffer(owner as never, Buffer.from('x'), 'text/plain');

  it('records who uploaded a file, from the request context', async () => {
    await requestContext.run(
      { userId: 'grantee', scopeId: 'owner1', accessLevel: 'WRITE' },
      () => save({ pluginId: 'projects', projectId: 'p1' }),
    );

    // The scope this lands in is the policy's business; the person is ours, and
    // the two are deliberately different here — a grantee adding a file to a
    // shared project.
    expect(deps.created[0].uploadedByUserId).toBe('grantee');
  });

  it('falls back to the explicit owner outside a request context', async () => {
    // The phone-capture upload runs on an anonymous tokenized route: there is
    // no caller to read, only the session's owner passed in by hand.
    await service.saveBuffer(
      { pluginId: 'capture', bridgeSessionId: 'br_1' } as never,
      Buffer.from('x'),
      'text/plain',
      'phone-owner',
    );

    expect(deps.created[0].uploadedByUserId).toBe('phone-owner');
  });

  it('leaves attribution blank when nothing knows who the caller is', async () => {
    await save({ pluginId: 'logistics' });

    expect(deps.created[0].uploadedByUserId).toBeNull();
  });

  // The path says WHEN, never WHOSE. Ownership moves — a photo claimed into a
  // chat, a file re-parented into a project — so a path that encoded it would
  // start lying the moment it did, or force a file move on every re-home. Being
  // owner-free it is also a valid object-store key as-is.
  it('files everything by date alone, whatever it belongs to', async () => {
    const now = new Date();
    const today = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('/');

    await save({ pluginId: 'projects', projectId: 'p1' });
    await save({ pluginId: 'inventory', componentId: 'c1' });
    await save({ pluginId: 'capture', bridgeSessionId: 'br_1' });

    for (const created of deps.created) {
      expect(created.storagePath).toMatch(
        new RegExp(`^${today}/att_[^/]+\\.[a-z0-9]+$`),
      );
    }
  });

  // Claiming re-homes a row, and the owner is a property of the WHOLE row: the
  // scope policy recomputes `scopeId` from the full set of parents, and refuses
  // a partial statement rather than guessing the unstated half.
  it('restates every parent when claiming, including the cleared ones', async () => {
    await service.claim('/api/uploads/att_1', {
      pluginId: 'chat',
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(deps.updated[0].data).toEqual({
      ownerPluginId: 'chat',
      projectId: 'p1',
      componentId: null,
      // A frame claimed out of an intake draft stops being the draft's (#216) —
      // which is exactly why every parent, cleared ones included, is restated.
      intakeDraftId: null,
      sessionId: 's1',
      bridgeSessionId: null,
    });
  });
});
