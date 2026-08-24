import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AttachmentStorageService } from './attachment-storage.service';
import { RequestContextService } from './request-context.service';

// Reading an attachment as text (#112), against real files: the verdict "this
// is text" is made from the BYTES, not from a mime type or an extension, and
// only a window of the file is ever read — a 200 MB log must cost one 64 KB
// read, not 200 MB of memory.

interface Row {
  id: string;
  projectId: string | null;
  storagePath: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
  isImage: boolean | null;
  previewXsPath: string | null;
  previewSmPath: string | null;
  previewLgPath: string | null;
  createdAt: Date;
  [key: string]: unknown;
}

const makeDeps = (root: string) => {
  const rows = new Map<string, Row>();
  const prisma = {
    attachment: {
      // The defaults below supply every column the service does not pass, so
      // the spread yields a complete Row on its own — typing `data` as a
      // partial row is what makes that checkable instead of asserted.
      create: ({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: '',
          storagePath: '',
          mimeType: '',
          sizeBytes: 0,
          projectId: null,
          previewXsPath: null,
          previewSmPath: null,
          previewLgPath: null,
          isImage: null,
          filename: null,
          createdAt: new Date(0),
          ...data,
        };
        rows.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      findMany: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
        Promise.resolve(
          [...rows.values()].filter(
            (row) => !where?.id?.in || where.id.in.includes(row.id),
          ),
        ),
      updateMany: () => Promise.resolve({ count: 0 }),
      deleteMany: () => Promise.resolve({ count: 0 }),
    },
  };
  const config = { getUploadsRoot: () => root };
  return { rows, prisma, config };
};

describe('AttachmentStorageService text reads', () => {
  let root: string;
  let deps: ReturnType<typeof makeDeps>;
  let service: AttachmentStorageService;

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'mk-text-'));
    deps = makeDeps(root);
    service = new AttachmentStorageService(
      deps.prisma as never,
      deps.config as never,
      new RequestContextService(),
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const store = async (
    content: Buffer,
    filename: string,
    mimeType = 'application/octet-stream',
  ): Promise<string> => {
    const { id } = await service.saveBuffer(
      { pluginId: 'projects', projectId: 'p1' },
      content,
      mimeType,
      undefined,
      filename,
    );
    return id;
  };

  it('reads a text file back', async () => {
    const id = await store(
      Buffer.from('M104 S210 ; hotend\nM140 S60\n', 'utf8'),
      'bracket.gcode',
    );
    const window = await service.readTextWindow(id, 0, 64 * 1024);
    expect(window?.text).toContain('M104 S210');
    expect(window?.bytesRead).toBe(window?.sizeBytes);
  });

  it('returns only the requested window and reports the full size', async () => {
    const body = Buffer.from('0123456789'.repeat(100), 'utf8');
    const id = await store(body, 'long.log', 'text/plain');

    const first = await service.readTextWindow(id, 0, 16);
    expect(first?.text).toBe('0123456789012345');
    expect(first?.bytesRead).toBe(16);
    expect(first?.sizeBytes).toBe(1000);

    const second = await service.readTextWindow(id, 16, 8);
    expect(second?.text).toBe('67890123');
  });

  // The reason the verdict is made here and not from the extension: an STL is
  // ASCII or binary depending on who exported it, and only the bytes know.
  it('accepts an ASCII STL and rejects a binary one', async () => {
    const asciiId = await store(
      Buffer.from('solid part\nfacet normal 0 0 1\nendsolid part\n', 'utf8'),
      'ascii.stl',
    );
    expect((await service.readTextWindow(asciiId, 0, 4096))?.text).toContain(
      'solid part',
    );

    const binaryId = await store(
      Buffer.concat([Buffer.alloc(80), Buffer.from([2, 0, 0, 0, 255, 0, 12])]),
      'binary.stl',
    );
    expect((await service.readTextWindow(binaryId, 0, 4096))?.text).toBeNull();
  });

  // A window may end mid-character. Trimming a stray tail beats declaring a
  // perfectly good UTF-8 file "not text" because the cut landed badly.
  it('tolerates a window cut mid-character', async () => {
    const id = await store(
      Buffer.from('данные', 'utf8'),
      'notes.txt',
      'text/plain',
    );
    const window = await service.readTextWindow(id, 0, 5);
    expect(window?.text).toBe('да');
  });

  it('rejects bytes that are not valid UTF-8', async () => {
    const id = await store(Buffer.from([0xc3, 0x28, 0x41]), 'broken.txt');
    expect((await service.readTextWindow(id, 0, 4096))?.text).toBeNull();
  });

  it('reads past the end as an empty window rather than failing', async () => {
    const id = await store(Buffer.from('short', 'utf8'), 'short.txt');
    const window = await service.readTextWindow(id, 999, 4096);
    expect(window?.text).toBe('');
    expect(window?.bytesRead).toBe(0);
  });

  it('returns null for an unknown attachment', async () => {
    expect(await service.readTextWindow('att_missing', 0, 10)).toBeNull();
  });

  // Metadata for the model's context line and the UI's file chip — columns
  // only, keyed by the URL each caller asked for.
  it('describes attachments by URL without opening them', async () => {
    const id = await store(Buffer.from('x', 'utf8'), 'notes.txt', 'text/plain');
    const metas = await service.findMetaByUrls([
      `/api/uploads/${id}`,
      '/api/uploads/att_missing',
    ]);
    expect(metas.size).toBe(1);
    expect(metas.get(`/api/uploads/${id}`)).toMatchObject({
      id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
    });
  });
});
