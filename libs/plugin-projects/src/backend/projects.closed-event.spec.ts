import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';

// The `projects.project.closed` emitter policy (#192): only the TRANSITION
// into the terminal status announces, from any surface, and a missing
// external host is a silent no-op.

const makeService = (opts: {
  beforeStatus: string;
  afterStatus: string;
  publish?: ReturnType<typeof vi.fn>;
}) => {
  const project = {
    id: 'proj_1',
    status: opts.afterStatus,
    scopeId: 's1',
  };
  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({ status: opts.beforeStatus })),
      findMany: vi.fn(async () => [{ id: 'proj_1', scopeId: 's1' }]),
      update: vi.fn(async () => project),
      create: vi.fn(async () => project),
    },
    activityEvent: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({ project: { update: vi.fn(async () => project) } }),
    ),
  };
  const capabilities = {
    getCapability: () =>
      opts.publish ? { publishDomainEvent: opts.publish } : null,
  };
  const service = new ProjectsService(
    prisma as never,
    { t: (k: string) => k } as never,
    {} as never,
    { emit: vi.fn() } as never,
    { isEnabled: () => true } as never,
    capabilities as never,
  );
  return { service, prisma };
};

describe('projects.project.closed emitter', () => {
  it('announces the open → COMPLETED transition with the canonical ref', async () => {
    const publish = vi.fn(async () => undefined);
    const { service } = makeService({
      beforeStatus: 'IN_PROGRESS',
      afterStatus: 'COMPLETED',
      publish,
    });
    await service.update('proj_1', { status: 'COMPLETED' });
    expect(publish).toHaveBeenCalledWith({
      type: 'projects.project.closed',
      scopeId: 's1',
      ref: 'mk://projects/project/proj_1',
    });
  });

  it('stays silent when the project was already closed', async () => {
    const publish = vi.fn(async () => undefined);
    const { service } = makeService({
      beforeStatus: 'COMPLETED',
      afterStatus: 'COMPLETED',
      publish,
    });
    await service.update('proj_1', { status: 'COMPLETED' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('stays silent on a non-status update — and reads no before-state', async () => {
    const publish = vi.fn(async () => undefined);
    const { service, prisma } = makeService({
      beforeStatus: 'IN_PROGRESS',
      afterStatus: 'IN_PROGRESS',
      publish,
    });
    await service.update('proj_1', { title: 'renamed' });
    expect(publish).not.toHaveBeenCalled();
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('a kanban drag into the done column closes the moved card', async () => {
    const publish = vi.fn(async () => undefined);
    const { service } = makeService({
      beforeStatus: 'IN_PROGRESS',
      afterStatus: 'COMPLETED',
      publish,
    });
    await service.reorderProjects('COMPLETED', ['proj_1'], 'proj_1');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('without the external host the close still succeeds silently', async () => {
    const { service } = makeService({
      beforeStatus: 'IN_PROGRESS',
      afterStatus: 'COMPLETED',
    });
    await expect(
      service.update('proj_1', { status: 'COMPLETED' }),
    ).resolves.toBeTruthy();
  });
});
