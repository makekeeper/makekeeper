import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { AttachmentStorageService } from './attachment-storage.service';
import { RequestContextService } from './request-context.service';

// Presence, not metadata (#127). A history payload built from "the rows that
// resolved" cannot say whether an attachment is gone or merely not loaded yet,
// which is how a deleted file kept rendering as a live download link — and the
// browser saved the 404's JSON body to disk. These specs pin the two halves of
// "gone": no row at all, and a row whose bytes are no longer there.

const ROW = {
  id: 'att_present',
  projectId: null,
  filename: 'part.stl',
  mimeType: 'model/stl',
  sizeBytes: 12,
  isImage: false,
  storagePath: '2026/07/27/att_present.stl',
};

const makePrisma = (rows: Record<string, unknown>[]) => ({
  attachment: {
    findMany: ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(rows.filter((r) => where.id.in.includes(r.id as string))),
  },
});

describe('AttachmentStorageService presence', () => {
  let root: string;

  const serviceWith = (
    rows: Record<string, unknown>[],
  ): AttachmentStorageService =>
    new AttachmentStorageService(
      makePrisma(rows) as never,
      { getUploadsRoot: () => root } as never,
      new RequestContextService(),
    );

  const writeStoredFile = async (relPath: string): Promise<void> => {
    await fsp.mkdir(join(root, dirname(relPath)), { recursive: true });
    await fsp.writeFile(join(root, relPath), 'bytes');
  };

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'mk-presence-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('describes an attachment whose row and file both exist', async () => {
    await writeStoredFile(ROW.storagePath);
    const presences = await serviceWith([ROW]).findPresenceByUrls([
      '/api/uploads/att_present',
    ]);
    expect(presences).toEqual([
      {
        status: 'available',
        url: '/api/uploads/att_present',
        filename: 'part.stl',
        mimeType: 'model/stl',
        sizeBytes: 12,
        isImage: false,
      },
    ]);
  });

  it('reports a URL with no row as missing rather than omitting it', async () => {
    const presences = await serviceWith([]).findPresenceByUrls([
      '/api/uploads/att_gone',
    ]);
    expect(presences).toEqual([
      { status: 'missing', url: '/api/uploads/att_gone', filename: null },
    ]);
  });

  it('reports a row whose bytes are not on disk as missing, keeping the name', async () => {
    const presences = await serviceWith([ROW]).findPresenceByUrls([
      '/api/uploads/att_present',
    ]);
    expect(presences).toEqual([
      {
        status: 'missing',
        url: '/api/uploads/att_present',
        filename: 'part.stl',
      },
    ]);
  });

  it('skips nullish entries and URLs that name no attachment', async () => {
    const presences = await serviceWith([]).findPresenceByUrls([
      null,
      undefined,
      'data:image/png;base64,AAAA',
    ]);
    expect(presences).toEqual([]);
  });

  it('answers the picture question from the probe, not the mime type', async () => {
    const legacy = {
      ...ROW,
      id: 'att_pic',
      filename: 'photo.heic',
      mimeType: 'image/heic',
      isImage: false,
      storagePath: '2026/07/27/att_pic.heic',
    };
    await writeStoredFile(legacy.storagePath);
    const presences = await serviceWith([legacy]).findPresenceByUrls([
      '/api/uploads/att_pic',
    ]);
    expect(presences[0]).toMatchObject({
      status: 'available',
      isImage: false,
    });
  });
});
