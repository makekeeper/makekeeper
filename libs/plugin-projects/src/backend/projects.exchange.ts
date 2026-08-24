import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AttachmentStorageService,
  ExchangeSectionProvider,
  PluginI18nService,
  PrismaService,
  generateUuid,
  isExchangeRecord,
  isRecordObject,
  readBoolean,
  readDate,
  readNumber,
  readOneOf,
  readOptionalString,
  readString,
  exchangeScopeStamp,
  exchangeScopeFilter,
  type ExchangeImportContext,
} from '@makekeeper/backend-core';
import { formatObjectRef, resolveEntityId } from '@makekeeper/plugin-contract';
import { ensureDefaultProjectGroup } from './project-groups.util';
import type { ProjectGroup } from '@prisma/client';
import { PROJECT_GROUP_MAX_DEPTH, normalizeGroupName } from '../project-groups';

// Exchange section providers of the projects plugin (#62): the `project` root
// section (the Project row + cover image), `projects.tasks` (tasks with their
// component/order links) and `projects.activity` (the activity log). Records
// carry explicit old ids; imports mint fresh ids and register them in the
// shared id-map under the ORef entity-type namespaces ('project', 'task').

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const ACTIVITY_KINDS = [
  'task_completed',
  'status_changed',
  'board_moved',
] as const;

function projectRef(id: string): string | null {
  return formatObjectRef({
    pluginId: 'projects',
    entityType: 'project',
    entityId: id,
  });
}

function taskRef(id: string): string | null {
  return formatObjectRef({
    pluginId: 'projects',
    entityType: 'task',
    entityId: id,
  });
}

// Translate an archive id through the id-map (verbatim on preserveIds).
function mapId(
  ctx: {
    preserveIds: boolean;
    idMap: { translate(t: string, id: string | null): string | null };
  },
  entityType: string,
  oldId: string | null,
): string | null {
  if (!oldId) return null;
  return ctx.preserveIds ? oldId : ctx.idMap.translate(entityType, oldId);
}

// The chain of `projectGroup` records from the root down to `groupId`. Each
// carries its own id and its parent's, so the import can rebuild the shape
// without a second query per level.
async function exportGroupChain(
  prisma: PrismaService,
  groupId: string,
): Promise<Record<string, unknown>[]> {
  const chain: Record<string, unknown>[] = [];
  let currentId: string | null = groupId;
  let depth = 0;
  while (currentId && depth < PROJECT_GROUP_MAX_DEPTH) {
    const group: ProjectGroup | null = await prisma.projectGroup.findUnique({
      where: { id: currentId },
    });
    if (!group) break;
    chain.unshift({
      t: 'projectGroup',
      id: group.id,
      name: group.name,
      parentId: group.parentId,
      position: group.position,
      isDefault: group.isDefault,
    });
    currentId = group.parentId;
    depth += 1;
  }
  return chain;
}

// Re-create the archived folder chain in the target scope and return the id the
// project should land in. A group that already exists under the same parent
// with the same name is reused — importing a project twice must not leave two
// identically named folders side by side. Returns null when the archive named
// no group at all (an older archive), leaving the caller to fall back.
async function importGroupChain(
  ctx: ExchangeImportContext,
  records: readonly unknown[],
  archivedGroupId: string | null,
): Promise<string | null> {
  if (!archivedGroupId) return null;
  const archived = new Map<string, Record<string, unknown>>();
  for (const raw of records) {
    if (!isExchangeRecord(raw, 'projectGroup')) continue;
    const id = readString(raw, 'id', 100);
    if (id) archived.set(id, raw);
  }
  // Root-first, so every parent exists before its child is created.
  const chain: Record<string, unknown>[] = [];
  let currentId: string | null = archivedGroupId;
  let depth = 0;
  while (currentId && depth < PROJECT_GROUP_MAX_DEPTH) {
    const rec = archived.get(currentId);
    if (!rec) break;
    chain.unshift(rec);
    currentId = readOptionalString(rec, 'parentId', 100) ?? null;
    depth += 1;
  }
  if (!chain.length) return null;

  let parentId: string | null = null;
  for (const rec of chain) {
    const name = readString(rec, 'name', 100);
    if (!name) continue;
    // The archive's default group IS the source scope's General. The target
    // scope already has one — under whatever name that instance's locale gave
    // it — so the chain continues from there instead of creating a second,
    // English-named root beside it.
    if (readBoolean(rec, 'isDefault', false) && parentId === null) {
      parentId = await ensureDefaultProjectGroup(ctx.tx, ctx.scopeId, name);
      continue;
    }
    const normalized = normalizeGroupName(name);
    const siblings = await ctx.tx.projectGroup.findMany({
      where: { parentId, ...exchangeScopeFilter(ctx) },
      select: { id: true, name: true },
    });
    const existing = siblings.find(
      (sibling) => normalizeGroupName(sibling.name) === normalized,
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created = await ctx.tx.projectGroup.create({
      data: {
        id: generateUuid(),
        name,
        parentId,
        position: readNumber(rec, 'position') ?? 0,
        // The archive's default flag does not travel: General is a property of
        // the scope you are importing INTO, and it already has one.
        isDefault: false,
        ...exchangeScopeStamp(ctx),
      },
    });
    parentId = created.id;
  }
  return parentId;
}

export function createProjectsExchangeProviders(
  prisma: PrismaService,
  attachments: AttachmentStorageService,
  i18n: PluginI18nService,
): ExchangeSectionProvider[] {
  const rootProvider: ExchangeSectionProvider = {
    sectionKey: 'projects.project',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'projects',
            entityType: 'project',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      // Scoped read: a foreign project resolves to null under the access policy.
      const project = await prisma.project.findUnique({
        where: { id: resolved.id },
      });
      if (!project) throw new NotFoundException('exchange.errors.rootNotFound');
      const ref = projectRef(project.id);
      if (ref) ctx.addExportedRef(ref);

      let cover: Record<string, unknown> | undefined;
      if (project.coverAttachmentId) {
        const att = await prisma.attachment.findUnique({
          where: { id: project.coverAttachmentId },
        });
        const file = att ? await attachments.resolveExistingFile(att.id) : null;
        if (att && file) {
          await ctx.files.putFileFromPath(att.id, file.path);
          cover = {
            id: att.id,
            mimeType: att.mimeType,
            filename: att.filename,
            sizeBytes: att.sizeBytes,
          };
        }
      }
      return {
        records: [
          {
            t: 'project',
            id: project.id,
            title: project.title,
            description: project.description,
            status: project.status,
            startDate: project.startDate?.toISOString() ?? null,
            dueDate: project.dueDate?.toISOString() ?? null,
            completedAt: project.completedAt?.toISOString() ?? null,
            position: project.position,
            budgetPlanned: project.budgetPlanned,
            budgetCurrency: project.budgetCurrency,
            createdAt: project.createdAt.toISOString(),
            groupId: project.groupId,
            cover,
          },
          // The project's folder and every folder above it. Names, not ids, are
          // what survives a move to another instance — the import re-creates
          // the chain by name and reuses a group that is already there.
          ...(await exportGroupChain(prisma, project.groupId)),
        ],
      };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'project')).length,
      };
    },

    async importSection(records, ctx) {
      const rec = records.find((r) => isExchangeRecord(r, 'project'));
      if (!rec)
        throw new BadRequestException('exchange.errors.archiveMalformed');
      const oldId = readString(rec, 'id', 100);
      const title = readString(rec, 'title', 300);
      if (!oldId || !title) {
        throw new BadRequestException('exchange.errors.archiveMalformed');
      }
      const newId = ctx.preserveIds ? oldId : generateUuid();
      ctx.idMap.set('project', oldId, newId);
      // The archive's folder chain is re-created (or matched) in the target
      // scope. A project whose group did not travel lands in General rather
      // than failing the import — a missing folder is not a corrupt archive.
      const groupId =
        (await importGroupChain(
          ctx,
          records,
          readString(rec, 'groupId', 100),
        )) ??
        (await ensureDefaultProjectGroup(
          ctx.tx,
          ctx.scopeId,
          i18n.t('projects.groups.defaultName'),
        ));
      await ctx.tx.project.create({
        data: {
          id: newId,
          groupId,
          title,
          description: readOptionalString(rec, 'description', 10_000),
          status: readString(rec, 'status', 40) ?? 'IDEA',
          startDate: readDate(rec, 'startDate'),
          dueDate: readDate(rec, 'dueDate'),
          // Carried verbatim rather than re-derived: an import is a restore, and
          // re-stamping it with "now" would move every completion to today.
          completedAt: readDate(rec, 'completedAt'),
          position: readNumber(rec, 'position') ?? 0,
          budgetPlanned: readNumber(rec, 'budgetPlanned'),
          budgetCurrency:
            readOptionalString(rec, 'budgetCurrency', 10) ?? 'USD',
          ...exchangeScopeStamp(ctx),
        },
      });

      // Cover image: recreate the attachment row through the transaction and
      // stage the bytes in the canonical uploads layout.
      const cover = rec['cover'];
      if (isRecordObject(cover)) {
        const coverRec = cover;
        const coverId = readString(coverRec, 'id', 100);
        const mimeType = readString(coverRec, 'mimeType', 100) ?? 'image/png';
        const src = coverId ? await ctx.files.filePath(coverId) : null;
        if (coverId && src) {
          const newAttId = 'att_' + generateUuid();
          const imported = await attachments.importFileFromPath(
            newAttId,
            mimeType,
            readOptionalString(coverRec, 'filename', 300),
            src,
          );
          await ctx.tx.attachment.create({
            data: {
              id: newAttId,
              ownerPluginId: 'projects',
              projectId: newId,
              storagePath: imported.relPath,
              mimeType,
              filename: readOptionalString(coverRec, 'filename', 300),
              sizeBytes: imported.sizeBytes,
              // Previews are regenerated on import, not carried in the archive
              // (#113) — a derivative is a cache, not data.
              isImage: imported.isImage,
              ...imported.previews,
              ...exchangeScopeStamp(ctx),
            },
          });
          await ctx.tx.project.update({
            where: { id: newId },
            data: { coverAttachmentId: newAttId },
          });
        }
      }
      return { created: 1, rootRef: projectRef(newId) ?? undefined };
    },
  };

  const tasksProvider: ExchangeSectionProvider = {
    sectionKey: 'projects.tasks',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'projects',
            entityType: 'project',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      const tasks = await prisma.task.findMany({
        where: { projectId: resolved.id },
        include: { components: true, orders: true },
        orderBy: { createdAt: 'asc' },
      });
      const records: Record<string, unknown>[] = [];
      const withComponents = ctx.selectedSections.has('inventory.components');
      const withOrders = ctx.selectedSections.has('logistics.orders');
      for (const task of tasks) {
        const ref = taskRef(task.id);
        if (ref) ctx.addExportedRef(ref);
        records.push({
          t: 'task',
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          description: task.description,
          isCompleted: task.isCompleted,
          dueDate: task.dueDate?.toISOString() ?? null,
          priority: task.priority,
          createdAt: task.createdAt.toISOString(),
        });
        if (withComponents) {
          for (const link of task.components) {
            records.push({
              t: 'taskComponent',
              taskId: task.id,
              componentId: link.componentId,
              quantity: link.quantity,
              isDone: link.isDone,
            });
          }
        }
        if (withOrders) {
          for (const link of task.orders) {
            records.push({
              t: 'taskOrder',
              taskId: task.id,
              orderId: link.orderId,
              isDone: link.isDone,
            });
          }
        }
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'task')).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'task')) continue;
        const oldId = readString(raw, 'id', 100);
        const oldProjectId = readString(raw, 'projectId', 100);
        const title = readString(raw, 'title', 300);
        if (!oldId || !oldProjectId || !title) continue;
        const projectId = ctx.preserveIds
          ? oldProjectId
          : ctx.idMap.translate('project', oldProjectId);
        if (!projectId) continue;
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('task', oldId, newId);
        await ctx.tx.task.create({
          data: {
            id: newId,
            projectId,
            title,
            description: readOptionalString(raw, 'description', 10_000),
            isCompleted: readBoolean(raw, 'isCompleted', false),
            dueDate: readDate(raw, 'dueDate'),
            priority: readOneOf(raw, 'priority', PRIORITIES, 'MEDIUM'),
          },
        });
        created += 1;
      }
      // Link rows second — their targets may sit later in the record stream.
      for (const raw of records) {
        if (isExchangeRecord(raw, 'taskComponent')) {
          const taskId = mapId(ctx, 'task', readString(raw, 'taskId', 100));
          const componentId = mapId(
            ctx,
            'component',
            readString(raw, 'componentId', 100),
          );
          if (!taskId || !componentId) continue;
          await ctx.tx.taskComponent.create({
            data: {
              id: generateUuid(),
              taskId,
              componentId,
              quantity: readNumber(raw, 'quantity') ?? 1,
              isDone: readBoolean(raw, 'isDone', false),
            },
          });
          created += 1;
        } else if (isExchangeRecord(raw, 'taskOrder')) {
          const taskId = mapId(ctx, 'task', readString(raw, 'taskId', 100));
          const orderId = mapId(ctx, 'order', readString(raw, 'orderId', 100));
          if (!taskId || !orderId) continue;
          await ctx.tx.taskOrderDependency.create({
            data: {
              id: generateUuid(),
              taskId,
              orderId,
              isDone: readBoolean(raw, 'isDone', false),
            },
          });
          created += 1;
        }
      }
      return { created };
    },
  };

  const activityProvider: ExchangeSectionProvider = {
    sectionKey: 'projects.activity',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'projects',
            entityType: 'project',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      const events = await prisma.activityEvent.findMany({
        where: { projectId: resolved.id },
        orderBy: { createdAt: 'asc' },
      });
      return {
        records: events.map((e) => ({
          t: 'activity',
          id: e.id,
          projectId: e.projectId,
          kind: e.kind,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'activity')).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'activity')) continue;
        const oldProjectId = readString(raw, 'projectId', 100);
        const createdAt = readDate(raw, 'createdAt');
        if (!oldProjectId || !createdAt) continue;
        const projectId = ctx.preserveIds
          ? oldProjectId
          : ctx.idMap.translate('project', oldProjectId);
        if (!projectId) continue;
        await ctx.tx.activityEvent.create({
          data: {
            id: ctx.preserveIds
              ? (readString(raw, 'id', 100) ?? generateUuid())
              : generateUuid(),
            projectId,
            kind: readOneOf(raw, 'kind', ACTIVITY_KINDS, 'status_changed'),
            createdAt,
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      return { created };
    },
  };

  return [rootProvider, tasksProvider, activityProvider];
}
