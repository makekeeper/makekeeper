import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  RequestContextService,
  generateUuid,
} from '@makekeeper/backend-core';
import type { ProjectGroup } from '@prisma/client';
import {
  GROUP_PATH_SEPARATOR,
  collectGroupSubtreeIds,
  groupAncestorPath,
  normalizeGroupName,
  type ProjectGroupDto,
} from '../project-groups';
import { ensureDefaultProjectGroup } from './project-groups.util';

const toDto = (group: ProjectGroup): ProjectGroupDto => ({
  id: group.id,
  name: group.name,
  parentId: group.parentId,
  position: group.position,
  isDefault: group.isDefault,
});

// The folder tree projects live in (#285/#287).
//
// The whole tree is loaded for every walk, like the category tree it follows:
// groups are a hand-made vocabulary numbering in the tens, so one query beats a
// recursive CTE nobody can read. Reads go through the scoped client, so "the
// whole tree" is always the caller's own.
@Injectable()
export class ProjectGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly requestContext: RequestContextService,
  ) {}

  private async loadAll(): Promise<ProjectGroup[]> {
    return this.prisma.projectGroup.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  private async require(id: string): Promise<ProjectGroup> {
    const group = await this.prisma.projectGroup.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException(this.i18n.t('projects.errors.groupNotFound'));
    }
    return group;
  }

  // The scope's General group, created on first access. There is no
  // "scope created" event to hook — a scopeId IS a user id — so this is called
  // from every path that needs a group to exist (see project-groups.util.ts for
  // why the id derivation is the race lock).
  async ensureDefaultGroupId(): Promise<string> {
    const scopeId = this.requestContext.get()?.scopeId ?? null;
    return ensureDefaultProjectGroup(
      this.prisma,
      scopeId,
      this.i18n.t('projects.groups.defaultName'),
    );
  }

  async list(): Promise<ProjectGroupDto[]> {
    await this.ensureDefaultGroupId();
    const all = await this.loadAll();
    return all.map(toDto);
  }

  // Every group id in the subtree rooted at `id` — what "filter by this group"
  // means everywhere. An unknown id resolves to itself alone, so a stale filter
  // narrows to nothing rather than silently widening to everything.
  async subtreeIds(id: string): Promise<string[]> {
    const all = await this.loadAll();
    return collectGroupSubtreeIds(id, all);
  }

  // Sibling name collision, case-insensitive. Postgres treats NULL as distinct,
  // so a database unique index could not carry this for root groups or for the
  // single-user NULL scope — the check lives here, like the tags service's.
  private async assertNameFree(
    name: string,
    parentId: string | null,
    exceptId?: string,
  ): Promise<void> {
    const normalized = normalizeGroupName(name);
    const siblings = await this.prisma.projectGroup.findMany({
      where: { parentId },
      select: { id: true, name: true },
    });
    const taken = siblings.some(
      (sibling) =>
        sibling.id !== exceptId &&
        normalizeGroupName(sibling.name) === normalized,
    );
    if (taken) {
      throw new BadRequestException(
        this.i18n.t('projects.errors.groupNameTaken'),
      );
    }
  }

  async create(input: {
    name: string;
    parentId?: string | null;
  }): Promise<ProjectGroupDto> {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException(
        this.i18n.t('projects.errors.groupNameRequired'),
      );
    }
    const parentId = input.parentId ?? null;
    if (parentId) await this.require(parentId);
    await this.assertNameFree(name, parentId);
    // New nodes land at the end of their sibling list — otherwise every group
    // is position 0 and dragging cannot mean anything.
    const last = await this.prisma.projectGroup.findFirst({
      where: { parentId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const created = await this.prisma.projectGroup.create({
      data: {
        id: generateUuid(),
        name,
        parentId,
        position: (last?.position ?? -1) + 1,
      },
    });
    return toDto(created);
  }

  async update(
    id: string,
    input: { name?: string; parentId?: string | null; position?: number },
  ): Promise<ProjectGroupDto> {
    const group = await this.require(id);
    const parentId =
      input.parentId === undefined ? group.parentId : input.parentId;
    const name = input.name === undefined ? group.name : input.name.trim();
    if (!name) {
      throw new BadRequestException(
        this.i18n.t('projects.errors.groupNameRequired'),
      );
    }

    if (input.parentId !== undefined && parentId !== group.parentId) {
      if (parentId === id) {
        throw new BadRequestException(
          this.i18n.t('projects.errors.groupCycle'),
        );
      }
      if (parentId) {
        await this.require(parentId);
        // Moving a group under its own descendant would cut the subtree off
        // from the root and make every walk spin until the depth cap.
        const subtree = await this.subtreeIds(id);
        if (subtree.includes(parentId)) {
          throw new BadRequestException(
            this.i18n.t('projects.errors.groupCycle'),
          );
        }
      }
    }

    if (input.name !== undefined || input.parentId !== undefined) {
      await this.assertNameFree(name, parentId, id);
    }

    const updated = await this.prisma.projectGroup.update({
      where: { id },
      data: {
        name,
        parentId,
        ...(input.position === undefined ? {} : { position: input.position }),
      },
    });
    return toDto(updated);
  }

  // The final sibling order after a drag: `movedId` may arrive from another
  // parent, in which case it is re-parented first (through `update`, so the
  // cycle guard and the name check still apply). Ids that do not belong to this
  // parent are ignored rather than silently re-filed.
  //
  // Returns the tree as it now stands. Not a courtesy: a handler returning
  // `void` sends an EMPTY body, and the client parses every response as JSON —
  // which fails with a message about a string not matching a pattern, blamed on
  // a drag the user just did. The caller also needs the new state anyway.
  async reorder(input: {
    parentId?: string | null;
    orderedIds: string[];
    movedId?: string;
  }): Promise<ProjectGroupDto[]> {
    const parentId = input.parentId ?? null;
    if (parentId) await this.require(parentId);
    if (input.movedId) {
      const moved = await this.require(input.movedId);
      if (moved.parentId !== parentId) {
        await this.update(input.movedId, { parentId });
      }
    }
    const siblings = await this.prisma.projectGroup.findMany({
      where: { parentId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((sibling) => sibling.id));
    const ordered = input.orderedIds.filter((id) => siblingIds.has(id));
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ordered.entries()) {
        await tx.projectGroup.update({
          where: { id },
          data: { position: index },
        });
      }
    });
    return this.list();
  }

  // What a delete would move, and where — the numbers the confirmation states
  // before anything happens.
  async deletePreview(
    id: string,
  ): Promise<{ projects: number; subgroups: number; destinationId: string }> {
    const group = await this.require(id);
    const [projects, subgroups] = await Promise.all([
      this.prisma.project.count({ where: { groupId: id } }),
      this.prisma.projectGroup.count({ where: { parentId: id } }),
    ]);
    return {
      projects,
      subgroups,
      destinationId: group.parentId ?? (await this.ensureDefaultGroupId()),
    };
  }

  // Deleting a group lifts its contents to its parent; a root group's contents
  // go to General. Nothing is destroyed — a folder disappearing must never take
  // projects with it.
  async delete(id: string): Promise<{ id: string; movedTo: string }> {
    const group = await this.require(id);
    if (group.isDefault) {
      throw new BadRequestException(
        this.i18n.t('projects.errors.groupDefaultUndeletable'),
      );
    }
    const destinationId = group.parentId ?? (await this.ensureDefaultGroupId());
    // One transaction: a delete that committed without the two moves that
    // protect its contents would strand projects on a group that is gone.
    await this.prisma.$transaction(async (tx) => {
      await tx.project.updateMany({
        where: { groupId: id },
        data: { groupId: destinationId },
      });
      // The SAME destination the projects get, not `group.parentId`: for a root
      // group that would be null, scattering its subgroups to the top level
      // while the confirmation promised they were moving to General.
      await tx.projectGroup.updateMany({
        where: { parentId: id },
        data: { parentId: destinationId },
      });
      await tx.projectGroup.delete({ where: { id } });
    });
    return { id, movedTo: destinationId };
  }

  // Move projects between groups — one batched write, used by the agent tool
  // and by the grid's bulk action alike.
  async moveProjects(
    projectIds: string[],
    groupId: string,
  ): Promise<{ moved: number; groupId: string }> {
    await this.require(groupId);
    const result = await this.prisma.project.updateMany({
      where: { id: { in: projectIds } },
      data: { groupId },
    });
    return { moved: result.count, groupId };
  }

  // Name + breadcrumb for `mk://projects/project-group/<id>`; the ancestor
  // chain is the breadcrumb a folder naturally has.
  async describe(
    id: string,
  ): Promise<{ displayName: string; breadcrumb?: string } | null> {
    const all = await this.loadAll();
    const group = all.find((candidate) => candidate.id === id);
    if (!group) return null;
    const path = groupAncestorPath(id, all);
    const ancestors = path.slice(0, -1);
    return {
      displayName: group.name,
      ...(ancestors.length
        ? { breadcrumb: ancestors.join(GROUP_PATH_SEPARATOR) }
        : {}),
    };
  }
}
