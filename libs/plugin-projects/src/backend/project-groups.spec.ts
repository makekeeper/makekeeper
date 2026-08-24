import { describe, it, expect } from 'vitest';
import type {
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { ProjectGroupsService } from './project-groups.service';
import { defaultProjectGroupId } from './project-groups.util';

// The rules the whole feature rests on (#287):
//   1. filtering by a group means the group AND everything below it,
//   2. a group cannot be moved into its own subtree,
//   3. deleting a group moves its contents up — it never deletes them,
//   4. General is created once per scope and is never deletable.
//
// The Prisma stub is hand-rolled, like the categories one: these tests are about
// which rows the service reads and writes, and a fake that answers honestly
// reads better than a stack of mockResolvedValueOnce.

interface FakeGroup {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  isDefault: boolean;
}

interface FakeProject {
  id: string;
  groupId: string;
}

const group = (
  id: string,
  name: string,
  parentId: string | null = null,
  isDefault = false,
): FakeGroup => ({ id, name, parentId, position: 0, isDefault });

function build(options: {
  groups?: FakeGroup[];
  projects?: FakeProject[];
  scopeId?: string | null;
}) {
  const groups = options.groups ?? [];
  const projects = options.projects ?? [];
  const created: Record<string, unknown>[] = [];
  const deleted: string[] = [];

  const delegates = {
    projectGroup: {
      findMany: ({ where }: { where?: { parentId?: string | null } } = {}) =>
        Promise.resolve(
          where && 'parentId' in where
            ? groups.filter((g) => g.parentId === (where.parentId ?? null))
            : groups,
        ),
      findFirst: ({ where }: { where: { parentId: string | null } }) => {
        const siblings = groups.filter((g) => g.parentId === where.parentId);
        if (!siblings.length) return Promise.resolve(null);
        return Promise.resolve(
          siblings.reduce((a, b) => (a.position >= b.position ? a : b)),
        );
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(groups.find((g) => g.id === where.id) ?? null),
      count: ({ where }: { where: { parentId: string } }) =>
        Promise.resolve(
          groups.filter((g) => g.parentId === where.parentId).length,
        ),
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        const row = {
          position: 0,
          isDefault: false,
          parentId: null,
          ...data,
        } as unknown as FakeGroup;
        groups.push(row);
        return Promise.resolve(row);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeGroup>;
      }) => {
        const found = groups.find((g) => g.id === where.id);
        if (found) Object.assign(found, data);
        return Promise.resolve({ ...found, ...data });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { parentId: string };
        data: { parentId: string | null };
      }) => {
        let count = 0;
        for (const g of groups) {
          if (g.parentId === where.parentId) {
            g.parentId = data.parentId;
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      delete: ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        const index = groups.findIndex((g) => g.id === where.id);
        if (index >= 0) groups.splice(index, 1);
        return Promise.resolve({});
      },
    },
    project: {
      count: ({ where }: { where: { groupId: string } }) =>
        Promise.resolve(
          projects.filter((p) => p.groupId === where.groupId).length,
        ),
      findMany: () => Promise.resolve(projects),
      updateMany: ({
        where,
        data,
      }: {
        where: { groupId?: string; id?: { in: string[] } };
        data: { groupId: string };
      }) => {
        let count = 0;
        for (const p of projects) {
          const hit =
            where.groupId !== undefined
              ? p.groupId === where.groupId
              : (where.id?.in ?? []).includes(p.id);
          if (hit) {
            p.groupId = data.groupId;
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    },
  };
  // The delete path runs its three writes in one transaction; the stub hands the
  // same delegates back, so the fake store still records them.
  const prisma = {
    ...delegates,
    $transaction: <T>(fn: (tx: typeof delegates) => Promise<T>): Promise<T> =>
      fn(delegates),
  } as unknown as PrismaService;

  const i18n = { t: (key: string) => key } as unknown as PluginI18nService;
  const requestContext = {
    get: () => ({ scopeId: options.scopeId ?? undefined }),
  } as unknown as RequestContextService;

  return {
    service: new ProjectGroupsService(prisma, i18n, requestContext),
    groups,
    projects,
    created,
    deleted,
  };
}

describe('ProjectGroupsService', () => {
  describe('default group', () => {
    it('creates General once per scope and reuses it afterwards', async () => {
      const { service, created, groups } = build({ scopeId: 'user-1' });
      const first = await service.ensureDefaultGroupId();
      const second = await service.ensureDefaultGroupId();
      expect(first).toBe(defaultProjectGroupId('user-1'));
      expect(second).toBe(first);
      expect(created).toHaveLength(1);
      expect(groups).toHaveLength(1);
      expect(groups[0].isDefault).toBe(true);
    });

    it('derives a different id for the single-user NULL scope', async () => {
      const { service } = build({ scopeId: null });
      expect(await service.ensureDefaultGroupId()).toBe(
        defaultProjectGroupId(null),
      );
      expect(defaultProjectGroupId(null)).not.toBe(
        defaultProjectGroupId('user-1'),
      );
    });

    it('refuses to delete the default group', async () => {
      const { service, groups } = build({
        groups: [group('g-def', 'General', null, true)],
      });
      await expect(service.delete('g-def')).rejects.toThrow(
        'projects.errors.groupDefaultUndeletable',
      );
      expect(groups).toHaveLength(1);
    });
  });

  describe('subtree resolution', () => {
    it('includes the group itself and every descendant', async () => {
      const { service } = build({
        groups: [
          group('root', 'Hardware'),
          group('mid', 'Boards', 'root'),
          group('leaf', 'ESP32', 'mid'),
          group('other', 'Software'),
        ],
      });
      const ids = await service.subtreeIds('root');
      expect(ids.sort()).toEqual(['leaf', 'mid', 'root']);
    });

    it('resolves an unknown group to itself alone', async () => {
      const { service } = build({ groups: [group('root', 'Hardware')] });
      expect(await service.subtreeIds('ghost')).toEqual(['ghost']);
    });
  });

  describe('move', () => {
    it('refuses moving a group into its own descendant', async () => {
      const { service } = build({
        groups: [
          group('root', 'Hardware'),
          group('mid', 'Boards', 'root'),
          group('leaf', 'ESP32', 'mid'),
        ],
      });
      await expect(
        service.update('root', { parentId: 'leaf' }),
      ).rejects.toThrow('projects.errors.groupCycle');
    });

    it('refuses moving a group into itself', async () => {
      const { service } = build({ groups: [group('root', 'Hardware')] });
      await expect(
        service.update('root', { parentId: 'root' }),
      ).rejects.toThrow('projects.errors.groupCycle');
    });

    it('allows a move that stays outside the subtree', async () => {
      const { service, groups } = build({
        groups: [
          group('root', 'Hardware'),
          group('mid', 'Boards', 'root'),
          group('other', 'Software'),
        ],
      });
      await service.update('mid', { parentId: 'other' });
      expect(groups.find((g) => g.id === 'mid')?.parentId).toBe('other');
    });

    it('refuses a name a sibling already uses, ignoring case', async () => {
      const { service } = build({
        groups: [group('a', 'Hardware'), group('b', 'Software')],
      });
      await expect(service.update('b', { name: 'hardware' })).rejects.toThrow(
        'projects.errors.groupNameTaken',
      );
    });
  });

  describe('delete', () => {
    it('lifts projects and subgroups to the parent', async () => {
      const { service, groups, projects, deleted } = build({
        groups: [
          group('root', 'Hardware'),
          group('mid', 'Boards', 'root'),
          group('leaf', 'ESP32', 'mid'),
        ],
        projects: [{ id: 'p1', groupId: 'mid' }],
      });
      const result = await service.delete('mid');
      expect(result.movedTo).toBe('root');
      expect(projects[0].groupId).toBe('root');
      expect(groups.find((g) => g.id === 'leaf')?.parentId).toBe('root');
      expect(deleted).toEqual(['mid']);
    });

    it("sends a root group's contents to General", async () => {
      const defaultId = defaultProjectGroupId('user-1');
      const { service, projects, groups } = build({
        scopeId: 'user-1',
        groups: [
          { ...group('gen', 'General', null, true), id: defaultId },
          group('root', 'Hardware'),
          group('sub', 'Boards', 'root'),
        ],
        projects: [{ id: 'p1', groupId: 'root' }],
      });
      const result = await service.delete('root');
      expect(result.movedTo).toBe(defaultId);
      expect(projects[0].groupId).toBe(defaultId);
      // Subgroups follow the projects: a root group's children become General's,
      // not new roots — which is what the confirmation promised.
      expect(groups.find((g) => g.id === 'sub')?.parentId).toBe(defaultId);
    });

    it('previews the counts and the destination before anything moves', async () => {
      const { service, projects } = build({
        groups: [group('root', 'Hardware'), group('mid', 'Boards', 'root')],
        projects: [
          { id: 'p1', groupId: 'mid' },
          { id: 'p2', groupId: 'mid' },
        ],
      });
      const preview = await service.deletePreview('mid');
      expect(preview).toEqual({
        projects: 2,
        subgroups: 0,
        destinationId: 'root',
      });
      // Nothing moved yet.
      expect(projects.every((p) => p.groupId === 'mid')).toBe(true);
    });
  });

  // A handler that returns nothing sends an empty body, and the client parses
  // every answer as JSON — which fails on the empty string, blaming a drag the
  // user just performed. Every mutation here answers with state.
  describe('reorder', () => {
    it('writes the new positions and answers with the tree', async () => {
      const { service, groups } = build({
        groups: [
          // The listing ensures General exists, so the fixture brings its own
          // rather than having one minted mid-assertion.
          {
            ...group('gen', 'General', null, true),
            id: defaultProjectGroupId(null),
          },
          group('a', 'Alpha'),
          { ...group('b', 'Beta'), position: 1 },
          { ...group('c', 'Gamma'), position: 2 },
        ],
      });
      const result = await service.reorder({
        parentId: null,
        orderedIds: ['c', 'a', 'b'],
        movedId: 'c',
      });
      expect(groups.find((g) => g.id === 'c')?.position).toBe(0);
      expect(groups.find((g) => g.id === 'a')?.position).toBe(1);
      expect(result.map((g) => g.id)).toContain('a');
      expect(result).toHaveLength(4);
    });
  });

  describe('describe (object reference)', () => {
    it('names the group and uses the ancestor chain as breadcrumb', async () => {
      const { service } = build({
        groups: [
          group('root', 'Hardware'),
          group('mid', 'Boards', 'root'),
          group('leaf', 'ESP32', 'mid'),
        ],
      });
      expect(await service.describe('leaf')).toEqual({
        displayName: 'ESP32',
        breadcrumb: 'Hardware / Boards',
      });
      expect(await service.describe('root')).toEqual({
        displayName: 'Hardware',
      });
      expect(await service.describe('ghost')).toBeNull();
    });
  });

  describe('moveProjects', () => {
    it('moves every named project in one write', async () => {
      const { service, projects } = build({
        groups: [group('root', 'Hardware'), group('other', 'Software')],
        projects: [
          { id: 'p1', groupId: 'root' },
          { id: 'p2', groupId: 'root' },
          { id: 'p3', groupId: 'other' },
        ],
      });
      const result = await service.moveProjects(['p1', 'p2'], 'other');
      expect(result).toEqual({ moved: 2, groupId: 'other' });
      expect(projects.map((p) => p.groupId)).toEqual([
        'other',
        'other',
        'other',
      ]);
    });
  });
});
