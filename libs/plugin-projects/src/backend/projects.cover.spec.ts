import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  CapabilityRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  AttachmentStorageService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  PICTURE_ATTACHMENT_WHERE,
  isPictureAttachment,
  type AttachmentCandidate,
} from '@makekeeper/plugin-contract';
import { ProjectsService } from './projects.service';

// Which picture the board paints (#122). The bug this pins: the cover query
// asked the picture question in a spelling that dropped every attachment
// predating the decode probe (#113, `isImage` NULL), so a pinned cover looked
// like a stale reference and the fallback silently won.
//
// The stub below pins the SHIPPED `where` fragment by identity and then answers
// with the JS rule the fragment mirrors, so a query that stops meaning what the
// JS rule means fails here rather than only against a real database. It also
// obeys the `orderBy` it is given: the fallback picks the EARLIEST image, and a
// stub that always sorted ascending would keep that green even if the service
// asked for `desc`.

interface Row extends AttachmentCandidate {
  id: string;
  projectId: string;
  createdAt: Date;
}

// The rule itself moved to `AttachmentStorageService` in #213 so inventory items
// could ask it of their own photographs. This spec therefore drives the REAL
// shared service over the same stub: what it pins is the shipped query, wherever
// that query now lives.
//
// The stub understands exactly one picture filter: the shared fragment. A
// hand-written variant (the `isImage: { not: false }` that caused #122) reaches
// this guard and fails loudly, instead of being quietly waved through and
// leaving the regression tests green against a filter that lies.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertSharedPictureFilter(where: unknown): void {
  const rest = isRecord(where)
    ? Object.fromEntries(
        Object.entries(where).filter(([key]) => key !== 'projectId'),
      )
    : {};
  if (JSON.stringify(rest) !== JSON.stringify(PICTURE_ATTACHMENT_WHERE)) {
    throw new Error(
      `cover query must select pictures with the shared fragment, got ${JSON.stringify(rest)}`,
    );
  }
}

// Reads the ordering off the query instead of assuming it, so "earliest, not
// newest" is a fact about the service rather than about this stub. The shared
// query orders by `createdAt` then `id` (the tie-break several frames of one
// burst need), so the clause arrives as a list.
function comparatorFor(orderBy: unknown): (a: Row, b: Row) => number {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  const primary = clauses[0];
  const direction = isRecord(primary) ? primary['createdAt'] : undefined;
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error(
      `cover query must order by createdAt, got ${JSON.stringify(orderBy)}`,
    );
  }
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) =>
    sign * (a.createdAt.getTime() - b.createdAt.getTime()) ||
    a.id.localeCompare(b.id);
}

const row = (
  id: string,
  projectId: string,
  createdAtMs: number,
  isImage: boolean | null,
  mimeType = 'image/jpeg',
): Row => ({
  id,
  projectId,
  createdAt: new Date(createdAtMs),
  isImage,
  mimeType,
  filename: `${id}.jpg`,
  sizeBytes: 1,
});

function makeService(
  projects: { id: string; coverAttachmentId: string | null }[],
  attachments: Row[],
): ProjectsService {
  const prisma = {
    project: {
      findMany: vi.fn(() =>
        Promise.resolve(
          projects.map((p) => ({
            ...p,
            title: p.id,
            description: null,
            status: 'IN_PROGRESS',
            budgetPlanned: null,
            budgetCurrency: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            startDate: null,
            dueDate: null,
            position: 0,
            tasks: [],
            components: [],
          })),
        ),
      ),
    },
    attachment: {
      findMany: vi.fn((args: { where?: unknown; orderBy?: unknown }) => {
        assertSharedPictureFilter(args.where);
        return Promise.resolve(
          attachments
            .filter(isPictureAttachment)
            .sort(comparatorFor(args.orderBy)),
        );
      }),
    },
    orderItem: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;

  const capabilities = {
    getCapability: vi.fn(() => undefined),
  } as unknown as CapabilityRegistryService;

  // The REAL attachment service, over the same stub: the cover query it issues
  // is the one this spec exists to pin.
  const attachmentStorage = new AttachmentStorageService(
    prisma,
    { getUploadsRoot: () => '/tmp' } as never,
    new RequestContextService(),
  );

  // findAll touches only prisma, the attachment service and the capability
  // registry here.
  return new ProjectsService(
    prisma,
    {} as never,
    attachmentStorage,
    {} as never,
    {} as never,
    capabilities,
  );
}

async function coverOf(
  projects: { id: string; coverAttachmentId: string | null }[],
  attachments: Row[],
  projectId: string,
): Promise<string | null> {
  const all = await makeService(projects, attachments).findAll();
  return all.find((p) => p.id === projectId)?.coverUrl ?? null;
}

describe('ProjectsService cover selection', () => {
  it('paints the pinned cover even when it predates the decode probe', async () => {
    const cover = await coverOf(
      [{ id: 'p1', coverAttachmentId: 'legacy' }],
      // Seeded newest-first throughout, so a result in upload order is the
      // service's ordering rather than the fixture's.
      [row('probed', 'p1', 3_000, true), row('legacy', 'p1', 1_000, null)],
      'p1',
    );
    expect(cover).toBe('/api/uploads/legacy');
  });

  it('gives a project whose images all predate the probe a cover', async () => {
    const cover = await coverOf(
      [{ id: 'p1', coverAttachmentId: null }],
      [row('old-a', 'p1', 2_000, null), row('old-b', 'p1', 1_000, null)],
      'p1',
    );
    expect(cover).toBe('/api/uploads/old-b');
  });

  it('falls back to the earliest image, not the newest, when nothing is pinned', async () => {
    const cover = await coverOf(
      [{ id: 'p1', coverAttachmentId: null }],
      [
        row('third', 'p1', 3_000, true),
        row('second', 'p1', 2_000, null),
        row('first', 'p1', 1_000, true),
      ],
      'p1',
    );
    expect(cover).toBe('/api/uploads/first');
  });

  // A format the decoder rejected renders as a file card, so the board must
  // never auto-pick it — the one exclusion the old filter got right.
  it('never picks a row the probe rejected', async () => {
    const cover = await coverOf(
      [{ id: 'p1', coverAttachmentId: null }],
      [
        row('png', 'p1', 2_000, true, 'image/png'),
        row('heic', 'p1', 1_000, false, 'image/heic'),
      ],
      'p1',
    );
    expect(cover).toBe('/api/uploads/png');
  });

  it('leaves a project without images uncovered', async () => {
    const cover = await coverOf(
      [{ id: 'p1', coverAttachmentId: null }],
      [row('doc', 'p1', 1_000, false, 'application/pdf')],
      'p1',
    );
    expect(cover).toBeNull();
  });
});
