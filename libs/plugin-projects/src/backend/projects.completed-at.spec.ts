import { describe, expect, it, vi } from 'vitest';
import { ProjectsService, closedStampPatch } from './projects.service';

// The completion stamp (#294). `completedAt` has exactly ONE write path — the
// status — and there are three doors into it: create, update, and the kanban
// drag. A door that forgets to stamp leaves a project that finished months ago
// claiming to still be running; a door that forgets to CLEAR leaves a reopened
// project carrying a completion date. Both are tested here, per door.

describe('closedStampPatch', () => {
  it('stamps when a project crosses into the terminal status', () => {
    const patch = closedStampPatch('IN_PROGRESS', 'COMPLETED');
    expect(patch.completedAt).toBeInstanceOf(Date);
  });

  it('clears when a project is reopened', () => {
    expect(closedStampPatch('COMPLETED', 'IN_PROGRESS')).toEqual({
      completedAt: null,
    });
  });

  // Editing a closed project's title must not move its completion date.
  it('leaves the stored date alone when the status does not move', () => {
    expect(closedStampPatch('COMPLETED', 'COMPLETED')).toEqual({});
    expect(closedStampPatch('IDEA', 'PLANNING')).toEqual({});
  });

  it('touches nothing when the write carries no status at all', () => {
    expect(closedStampPatch('COMPLETED', undefined)).toEqual({});
    expect(closedStampPatch(undefined, 'COMPLETED')).toEqual({});
  });
});

const makeService = (beforeStatus: string) => {
  const updated: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({ status: beforeStatus })),
      // Honours the `status: { not: CLOSED }` filter the service actually
      // sends. A stub that answers the same rows whatever the where-clause
      // would report every card as "was open" and hide the re-sort bug.
      findMany: vi.fn(async () =>
        beforeStatus === 'COMPLETED' ? [] : [{ id: 'proj_1', scopeId: 's1' }],
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return { id: 'proj_1', status: 'COMPLETED', scopeId: 's1' };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'proj_1', status: data.status, scopeId: 's1' };
      }),
    },
    projectGroup: { findFirst: vi.fn(async () => ({ id: 'grp_1' })) },
    activityEvent: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        project: {
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            updated.push(data);
            return { id: 'proj_1' };
          }),
        },
      }),
    ),
  };
  const service = new ProjectsService(
    prisma as never,
    { t: (k: string) => k } as never,
    {} as never,
    { emit: vi.fn() } as never,
    { isEnabled: () => false } as never,
    { getCapability: () => null } as never,
  );
  return { service, updated, created };
};

describe('the three write paths', () => {
  it('update stamps the transition into the terminal status', async () => {
    const { service, updated } = makeService('IN_PROGRESS');
    await service.update('proj_1', { status: 'COMPLETED' });
    expect(updated[0].completedAt).toBeInstanceOf(Date);
  });

  it('update clears the stamp when a closed project is reopened', async () => {
    const { service, updated } = makeService('COMPLETED');
    await service.update('proj_1', { status: 'IN_PROGRESS' });
    expect(updated[0].completedAt).toBeNull();
  });

  it('update leaves the stamp untouched when only the title changes', async () => {
    const { service, updated } = makeService('COMPLETED');
    await service.update('proj_1', { title: 'Корпус v3' });
    expect(updated[0]).not.toHaveProperty('completedAt');
  });

  // Recording an already-finished build is a legitimate way to create a project.
  it('create stamps a project that is born closed', async () => {
    const { service, created } = makeService('IDEA');
    await service.create({
      title: 'Корпус v1',
      description: '',
      status: 'COMPLETED',
      groupId: 'grp_1',
    });
    expect(created[0].completedAt).toBeInstanceOf(Date);
  });

  it('create leaves an open project unstamped', async () => {
    const { service, created } = makeService('IDEA');
    await service.create({
      title: 'Кожух',
      description: '',
      status: 'IDEA',
      groupId: 'grp_1',
    });
    expect(created[0].completedAt).toBeNull();
  });

  it('a drag into the terminal column stamps the card that was open', async () => {
    const { service, updated } = makeService('IN_PROGRESS');
    await service.reorderProjects('COMPLETED', ['proj_1'], 'proj_1');
    expect(updated[0].completedAt).toBeInstanceOf(Date);
  });

  it('a drag out of the terminal column clears the stamp', async () => {
    const { service, updated } = makeService('COMPLETED');
    await service.reorderProjects('IN_PROGRESS', ['proj_1'], 'proj_1');
    expect(updated[0].completedAt).toBeNull();
  });

  // Re-sorting the done column is not re-closing its cards: a card already
  // closed keeps the date it closed on.
  it('re-sorting the terminal column does not re-stamp cards already closed', async () => {
    const { service, updated } = makeService('COMPLETED');
    await service.reorderProjects('COMPLETED', ['proj_1', 'proj_2']);
    for (const data of updated) expect(data).not.toHaveProperty('completedAt');
  });
});
