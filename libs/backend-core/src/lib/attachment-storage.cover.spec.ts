import { AttachmentStorageService } from './attachment-storage.service';
import { RequestContextService } from './request-context.service';

// The cover rule, in one place for every owner kind (#213).
//
// It used to live in `projects.service.ts`; inventory items now ask the same
// question of their own photographs, and the decision table below is what a
// second copy would have started drifting from. It is also the runtime half of
// the #213 migration's backfill: a pin that resolves wins, a pin that resolves
// to nothing falls back, no pictures means no cover.

interface Row {
  id: string;
  projectId: string | null;
  componentId: string | null;
  createdAt: Date;
  isImage: boolean | null;
  mimeType: string;
}

const picture = (
  id: string,
  owner: Partial<Pick<Row, 'projectId' | 'componentId'>>,
  minute: number,
): Row => ({
  id,
  projectId: null,
  componentId: null,
  ...owner,
  createdAt: new Date(Date.UTC(2026, 7, 3, 12, minute)),
  isImage: true,
  mimeType: 'image/jpeg',
});

// A minimal Prisma double: the service asks for pictures of a set of owners,
// ordered by createdAt then id. Both are applied here so the ordering the real
// query promises is the ordering the test sees.
const makePrisma = (rows: Row[]) => ({
  attachment: {
    findMany: ({
      where,
    }: {
      where: {
        projectId?: { in: string[] };
        componentId?: { in: string[] };
      };
    }) =>
      Promise.resolve(
        rows
          .filter((row) =>
            where.projectId
              ? row.projectId !== null &&
                where.projectId.in.includes(row.projectId)
              : row.componentId !== null &&
                where.componentId !== undefined &&
                where.componentId.in.includes(row.componentId),
          )
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() ||
              a.id.localeCompare(b.id),
          ),
      ),
  },
});

const serviceWith = (rows: Row[]): AttachmentStorageService =>
  new AttachmentStorageService(
    makePrisma(rows) as never,
    { getUploadsRoot: () => '/tmp' } as never,
    new RequestContextService(),
  );

describe('AttachmentStorageService cover resolution', () => {
  it('honours a pin that still resolves to one of the pictures', async () => {
    const service = serviceWith([
      picture('att_first', { componentId: 'comp_1' }, 1),
      picture('att_pinned', { componentId: 'comp_1' }, 2),
    ]);
    const covers = await service.coverUrlByOwner(
      [{ id: 'comp_1', coverAttachmentId: 'att_pinned' }],
      'componentId',
    );
    expect(covers.get('comp_1')).toBe('/api/uploads/att_pinned');
  });

  // A pin naming an attachment that is gone (deleted, or never the item's)
  // falls back to the earliest picture rather than showing nothing (#122).
  it('falls back to the earliest picture when the pin resolves to nothing', async () => {
    const service = serviceWith([
      picture('att_first', { componentId: 'comp_1' }, 1),
      picture('att_second', { componentId: 'comp_1' }, 2),
    ]);
    const covers = await service.coverUrlByOwner(
      [{ id: 'comp_1', coverAttachmentId: 'att_dangling' }],
      'componentId',
    );
    expect(covers.get('comp_1')).toBe('/api/uploads/att_first');
  });

  it('uses the earliest picture when nothing is pinned', async () => {
    const service = serviceWith([
      picture('att_second', { componentId: 'comp_1' }, 2),
      picture('att_first', { componentId: 'comp_1' }, 1),
    ]);
    const covers = await service.coverUrlByOwner(
      [{ id: 'comp_1', coverAttachmentId: null }],
      'componentId',
    );
    expect(covers.get('comp_1')).toBe('/api/uploads/att_first');
  });

  it('reports no cover for an owner with no pictures', async () => {
    const service = serviceWith([]);
    const covers = await service.coverUrlByOwner(
      [{ id: 'comp_1', coverAttachmentId: 'att_gone' }],
      'componentId',
    );
    expect(covers.has('comp_1')).toBe(false);
  });

  it('never crosses owners', async () => {
    const service = serviceWith([
      picture('att_mine', { componentId: 'comp_1' }, 1),
      picture('att_theirs', { componentId: 'comp_2' }, 2),
    ]);
    const covers = await service.coverUrlByOwner(
      [
        { id: 'comp_1', coverAttachmentId: null },
        { id: 'comp_2', coverAttachmentId: null },
      ],
      'componentId',
    );
    expect(covers.get('comp_1')).toBe('/api/uploads/att_mine');
    expect(covers.get('comp_2')).toBe('/api/uploads/att_theirs');
  });

  it('answers the same question for projects', async () => {
    const service = serviceWith([
      picture('att_p1', { projectId: 'proj_1' }, 1),
      picture('att_p2', { projectId: 'proj_1' }, 2),
    ]);
    const covers = await service.coverUrlByOwner(
      [{ id: 'proj_1', coverAttachmentId: 'att_p2' }],
      'projectId',
    );
    expect(covers.get('proj_1')).toBe('/api/uploads/att_p2');
  });

  it('returns the whole set in upload order, with the cover marked', async () => {
    const service = serviceWith([
      picture('att_a', { componentId: 'comp_1' }, 1),
      picture('att_b', { componentId: 'comp_1' }, 2),
      picture('att_c', { componentId: 'comp_1' }, 3),
    ]);
    const photos = await service.photosByOwner(
      [{ id: 'comp_1', coverAttachmentId: 'att_c' }],
      'componentId',
    );
    expect(photos.get('comp_1')).toEqual([
      { id: 'att_a', url: '/api/uploads/att_a', isCover: false },
      { id: 'att_b', url: '/api/uploads/att_b', isCover: false },
      { id: 'att_c', url: '/api/uploads/att_c', isCover: true },
    ]);
  });

  // Several frames of one item can land inside the same millisecond — the phone
  // uploads a burst — so `id` breaks the tie and the fallback cover stops
  // wandering between two reads of the same row.
  it('breaks a createdAt tie by id', async () => {
    const service = serviceWith([
      picture('att_z', { componentId: 'comp_1' }, 1),
      picture('att_a', { componentId: 'comp_1' }, 1),
    ]);
    const covers = await service.coverUrlByOwner(
      [{ id: 'comp_1', coverAttachmentId: null }],
      'componentId',
    );
    expect(covers.get('comp_1')).toBe('/api/uploads/att_a');
  });

  it('asks the database nothing when there are no owners', async () => {
    const findMany = jest.fn();
    const service = new AttachmentStorageService(
      { attachment: { findMany } } as never,
      { getUploadsRoot: () => '/tmp' } as never,
      new RequestContextService(),
    );
    expect((await service.photosByOwner([], 'componentId')).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
