import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  AttachmentStorageService,
  sanitizeHtml,
  generateUuid,
  getErrorMessage,
  PluginEventBusService,
  PluginConfigService,
  CapabilityRegistryService,
  type StatsPoint,
} from '@makekeeper/backend-core';
import {
  isPictureAttachment,
  PROJECTS_COMPONENT_UNLINKED_EVENT,
  COMPONENT_ORDER_INFO_CAPABILITY,
  EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
  LOGISTICS_INCOMING_CAPABILITY,
  INVENTORY_STOCK_FACTS_CAPABILITY,
  PROJECTS_PROJECT_CLOSED_EVENT,
  formatObjectRef,
  type ExternalEventsPublishCapability,
  type ProjectsComponentUnlinkedEvent,
  type ComponentOrderInfoCapability,
  type LogisticsIncomingCapability,
  type InventoryStockFactsCapability,
} from '@makekeeper/plugin-contract';
import {
  BENCH_ACTIVE_STATUSES,
  PROJECT_CLOSED_STATUS,
  isIncomingOrderStatus,
  type BenchLineState,
  type BenchProject,
  type BenchReadinessLine,
  type BenchResponse,
  type BenchSummary,
  type BenchTask,
  type BenchTaskState,
  type BenchWaitingOrder,
} from '../bench';
import { ProjectGroupsService } from './project-groups.service';

// Where a stored file can be reached, for the surfaces that turn a
// `mk://projects/file/<id>` ORef into a place (#112). A null `projectId` is a
// real answer, not a failure: the file exists but belongs to no project, so
// there is no Files tab to open.
export interface ProjectFileLocation {
  id: string;
  filename: string | null;
  projectId: string | null;
  projectTitle: string | null;
}

// The closed-completion stamp (#294), as a patch on a Prisma update.
//
// `completedAt` has exactly one write path — the status. Exposing it as its own
// editable field would let a row claim it finished yesterday while sitting in
// IDEA, so instead every status write runs through here: crossing INTO the
// terminal status stamps now, crossing OUT clears. A status write that does not
// cross the boundary (or no status write at all) leaves the stored date alone —
// editing a closed project's title must not move its completion.
export function closedStampPatch(
  before: string | undefined,
  next: string | undefined,
): { completedAt?: Date | null } {
  if (next === undefined || before === undefined) return {};
  const wasClosed = before === PROJECT_CLOSED_STATUS;
  const isClosed = next === PROJECT_CLOSED_STATUS;
  if (!wasClosed && isClosed) return { completedAt: new Date() };
  if (wasClosed && !isClosed) return { completedAt: null };
  return {};
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly attachments: AttachmentStorageService,
    private readonly eventBus: PluginEventBusService,
    private readonly pluginConfig: PluginConfigService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly groups: ProjectGroupsService,
  ) {}

  // Best-effort append to the project activity log for actions that leave no
  // other timestamped row (ticket #54). Runs inside the caller's request
  // context, so the scope policy stamps scopeId automatically. A logging failure
  // must never break the core mutation, so it is swallowed with a warning.
  private async recordActivity(projectId: string, kind: string): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: { id: generateUuid(), projectId, kind },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record activity "${kind}" for project ${projectId}: ${getErrorMessage(error)}`,
      );
    }
  }

  // `groupId` narrows the list to a group and everything below it — the
  // descendant-inclusive contract every surface shares (#287). Resolution is
  // the groups service's single subtree helper, never a second tree walk.
  async findAll(groupId?: string) {
    const groupIds = groupId ? await this.groups.subtreeIds(groupId) : null;
    const projects = await this.prisma.project.findMany({
      ...(groupIds ? { where: { groupId: { in: groupIds } } } : {}),
      include: {
        tasks: {
          include: {
            components: {
              include: {
                component: true,
              },
            },
            orders: {
              include: {
                order: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        components: {
          include: {
            component: true,
          },
        },
      },
      // position drives the manual kanban order within a status column; createdAt
      // breaks ties (and orders projects that predate any drag). The grid view
      // re-sorts by createdAt client-side, so this ordering serves the board.
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });

    // Component price is no longer stored (#50) — value reserved stock at the
    // last unit price paid for each component (from order history).
    const lastPrices = await this.lastUnitPriceByComponent();

    // Cover per project: the pinned `coverAttachmentId` while it still resolves
    // to one of the project's images, otherwise the earliest one. The rule moved
    // to `AttachmentStorageService` in #213, where an inventory item asks the
    // same question of its own pictures — a second copy is the first place the
    // two would drift. One query for all projects (no N+1); the scoped Prisma
    // client only returns the caller's own rows.
    const coverByProject = await this.attachments.coverUrlByOwner(
      projects.map((p) => ({
        id: p.id,
        coverAttachmentId: p.coverAttachmentId,
      })),
      'projectId',
    );

    return projects.map((p) => {
      const completedTasksCount = p.tasks.filter((t) => t.isCompleted).length;
      const tasksCount = p.tasks.length;

      const actualBudget = p.components.reduce((acc, pc) => {
        return (
          acc + pc.reservedQty * (lastPrices.get(pc.componentId)?.price || 0)
        );
      }, 0);

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
        budgetPlanned: p.budgetPlanned,
        budgetCurrency: p.budgetCurrency,
        actualBudget: Number(actualBudget.toFixed(2)),
        tasksCount,
        completedTasksCount,
        componentsCount: p.components.length,
        // Raw ISO (or null) — the frontend formats by the viewer's locale.
        createdAt: p.createdAt.toISOString(),
        // Last-activity ordering for the dashboard status widget.
        updatedAt: p.updatedAt.toISOString(),
        startDate: p.startDate?.toISOString() ?? null,
        dueDate: p.dueDate?.toISOString() ?? null,
        // Read-only outside the service (#294) — see closedStampPatch.
        completedAt: p.completedAt?.toISOString() ?? null,
        position: p.position,
        groupId: p.groupId,
        coverUrl: coverByProject.get(p.id) ?? null,
        tasks: p.tasks,
        components: p.components,
      };
    });
  }

  // ── Files / attachments (project build-log: photos + any file) ────────────

  private toFileDto(a: {
    id: string;
    mimeType: string;
    filename: string | null;
    sizeBytes: number;
    createdAt: Date;
    isImage: boolean | null;
  }): {
    id: string;
    url: string;
    mimeType: string;
    filename: string | null;
    isImage: boolean;
    sizeBytes: number;
    createdAt: string;
  } {
    return {
      id: a.id,
      url: `/api/uploads/${a.id}`,
      mimeType: a.mimeType,
      filename: a.filename,
      // Decided by probing the bytes on upload (#113), so an undecodable
      // format (HEIC, corrupt) shows as a file card instead of a broken <img>.
      // Null on rows that predate the probe — those keep the old mime guess.
      isImage: isPictureAttachment(a),
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    };
  }

  // One stored file with the project it belongs to. `projectId` is null for a
  // file that belongs to no project — a chat attachment that was never claimed
  // — which is what tells the link surface there is nowhere to navigate to.
  //
  // Scoped Prisma does the access check: a row outside
  // the caller's scope reads back as missing, so an ORef someone else's file
  // resolves to nothing rather than leaking a filename.
  async findFile(attachmentId: string): Promise<ProjectFileLocation | null> {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, filename: true, projectId: true },
    });
    if (!att) return null;
    const project = att.projectId
      ? await this.prisma.project.findUnique({
          where: { id: att.projectId },
          select: { title: true },
        })
      : null;
    return {
      id: att.id,
      filename: att.filename,
      projectId: att.projectId,
      projectTitle: project?.title ?? null,
    };
  }

  async listFiles(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { coverAttachmentId: true },
    });
    const coverId = project?.coverAttachmentId ?? null;
    const rows = await this.prisma.attachment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        mimeType: true,
        filename: true,
        sizeBytes: true,
        createdAt: true,
        isImage: true,
      },
    });
    const dtos = rows.map((a) => ({
      ...this.toFileDto(a),
      isCover: a.id === coverId,
    }));
    // Pinned cover first, the rest in upload order.
    return dtos.sort((a, b) => (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0));
  }

  // Pin an image as the project cover (or clear with null). Validates ownership
  // and that the target is an image the browser can actually paint — the shared
  // `isPictureAttachment` rule, the same one `toFileDto` shows and
  // `photosByOwner` queries with (#122), so what may be pinned and what may
  // be painted are one decision.
  async setCover(
    projectId: string,
    attachmentId: string | null,
  ): Promise<{ ok: boolean }> {
    if (attachmentId) {
      const att = await this.prisma.attachment.findUnique({
        where: { id: attachmentId },
      });
      if (!att || att.projectId !== projectId || !isPictureAttachment(att)) {
        return { ok: false };
      }
    }
    await this.prisma.project.update({
      where: { id: projectId },
      data: { coverAttachmentId: attachmentId },
    });
    return { ok: true };
  }

  async addFile(projectId: string, dataUrl: string, filename?: string) {
    const url = await this.attachments.saveDataUrl(
      { pluginId: 'projects', projectId },
      dataUrl,
      undefined,
      filename,
    );
    if (!url) return null;
    const created = await this.attachments.findByUrl(url);
    if (!created) return null;
    return this.toFileDto({
      id: created.id,
      mimeType: created.mimeType,
      filename: filename ?? null,
      sizeBytes: created.sizeBytes,
      createdAt: created.createdAt,
      isImage: created.isImage,
    });
  }

  async deleteFile(
    projectId: string,
    attachmentId: string,
  ): Promise<{ ok: boolean }> {
    // Guard: only delete a file that actually belongs to this project (scope
    // enforcement already limits visibility to the caller's own rows).
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att || att.projectId !== projectId) return { ok: false };
    await this.attachments.deleteById(attachmentId);
    // If the deleted file was the pinned cover, clear the pin (falls back to the
    // earliest image).
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { coverAttachmentId: true },
    });
    if (project?.coverAttachmentId === attachmentId) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { coverAttachmentId: null },
      });
    }
    return { ok: true };
  }

  // ── Shopping list / BOM ───────────────────────────────────────────────────

  // "What still needs to be bought" for a project. For each linked component the
  // outstanding need is neededQty − reservedQty; of that, free stock on hand can
  // be reserved without buying, so toBuy = max(0, need − reserved − freeStock).
  // Only shortfall rows (toBuy > 0) are returned, with a last-paid cost estimate.
  async getShoppingList(projectId: string): Promise<{
    items: {
      componentId: string;
      name: string;
      sku: string | null;
      neededQty: number;
      reservedQty: number;
      availableStock: number;
      toBuy: number;
      unitPrice: number | null;
      currency: string | null;
      estCost: number | null;
    }[];
    totals: { currency: string; amount: number }[];
  }> {
    const links = await this.prisma.projectComponent.findMany({
      where: { projectId },
      include: { component: true },
    });
    const lastPrices = await this.lastUnitPriceByComponent();

    const items = links
      .map((pc) => {
        const toBuy = Math.max(
          0,
          pc.neededQty - pc.reservedQty - pc.component.quantity,
        );
        const priceInfo = lastPrices.get(pc.componentId) ?? null;
        return {
          componentId: pc.componentId,
          name: pc.component.name,
          sku: pc.component.sku,
          neededQty: pc.neededQty,
          reservedQty: pc.reservedQty,
          availableStock: pc.component.quantity,
          toBuy,
          unitPrice: priceInfo?.price ?? null,
          // Currency of the last order this part was bought in — not the
          // project's default — so the estimate is labelled honestly.
          currency: priceInfo?.currency ?? null,
          estCost:
            priceInfo != null
              ? Number((toBuy * priceInfo.price).toFixed(2))
              : null,
        };
      })
      .filter((item) => item.toBuy > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    // Totals grouped per currency — a home shop may buy in EUR and USD; we never
    // fake an FX conversion into one number.
    const byCurrency = new Map<string, number>();
    for (const item of items) {
      if (item.estCost != null && item.currency) {
        byCurrency.set(
          item.currency,
          (byCurrency.get(item.currency) ?? 0) + item.estCost,
        );
      }
    }
    const totals = [...byCurrency.entries()]
      .map(([currency, amount]) => ({
        currency,
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    return { items, totals };
  }

  // Most-recent unit price paid per component, from order history — replaces the
  // removed Component.price for budget valuation (#50). Order history is
  // logistics functionality (#58), resolved through the capability registry:
  // empty while logistics is disabled, so estimates just don't show.
  private async lastUnitPriceByComponent(): Promise<
    Map<string, { price: number; currency: string }>
  > {
    const orderInfo =
      this.capabilities.getCapability<ComponentOrderInfoCapability>(
        COMPONENT_ORDER_INFO_CAPABILITY,
      );
    return (
      (await orderInfo?.lastPriceByComponent()) ??
      new Map<string, { price: number; currency: string }>()
    );
  }

  // Quantity on the way per (project, component), from order history (logistics,
  // #58/#90) — attributed to the project each order was placed for, NOT a global
  // per-component sum, so a part two projects both await is never counted for
  // both. Empty while logistics is disabled — the bench then simply never shows
  // the "on order" state, degrading a shortfall to plain "missing".
  private async onOrderByProject(): Promise<Map<string, Map<string, number>>> {
    const orderInfo =
      this.capabilities.getCapability<ComponentOrderInfoCapability>(
        COMPONENT_ORDER_INFO_CAPABILITY,
      );
    return (
      (await orderInfo?.onOrderByProjectComponent()) ??
      new Map<string, Map<string, number>>()
    );
  }

  // The bench dashboard (#90): for every active project, the readiness of its
  // bill of materials and the startability of each open task. Free stock is our
  // own data (Component.quantity, already net of reservations); "on order" is
  // resolved from logistics via the capability registry; nothing here reaches
  // into another plugin's code. The scoped Prisma client already limits every
  // row to the caller, so the aggregate is scope-safe.
  async getBench(): Promise<BenchResponse> {
    const projects = await this.prisma.project.findMany({
      where: { status: { in: [...BENCH_ACTIVE_STATUSES] } },
      include: {
        tasks: {
          include: {
            components: { include: { component: true } },
            orders: { include: { order: true } },
          },
        },
        components: { include: { component: true } },
      },
    });

    const onOrderByProject = await this.onOrderByProject();

    const benchProjects: BenchProject[] = projects.map((project) => {
      // Only this project's own incoming orders count toward its readiness.
      const onOrder =
        onOrderByProject.get(project.id) ?? new Map<string, number>();
      const lines: BenchReadinessLine[] = project.components.map((pc) => {
        // `quantity` is already net of reservations, so it is the free pool.
        const free = pc.component.quantity;
        const short = Math.max(0, pc.neededQty - pc.reservedQty - free);
        const covered = (onOrder.get(pc.componentId) ?? 0) >= short;
        const state: BenchLineState =
          pc.reservedQty >= pc.neededQty
            ? 'reserved'
            : short === 0
              ? 'inStock'
              : covered
                ? 'onOrder'
                : 'missing';
        return {
          componentId: pc.componentId,
          name: pc.component.name,
          needed: pc.neededQty,
          reserved: pc.reservedQty,
          free,
          deficit: short,
          state,
        };
      });

      const countBy = (s: BenchLineState): number =>
        lines.filter((l) => l.state === s).length;

      // Orders any open task explicitly waits on (TaskOrderDependency), minus
      // the ones the maker already ticked off by hand (`isDone`).
      const waiting = new Map<string, BenchWaitingOrder>();
      for (const task of project.tasks) {
        if (task.isCompleted) continue;
        for (const dep of task.orders) {
          if (dep.isDone) continue;
          if (!isIncomingOrderStatus(dep.order.status)) continue;
          waiting.set(dep.order.id, {
            id: dep.order.id,
            storeName: dep.order.storeName,
            estimatedDelivery:
              dep.order.estimatedDelivery?.toISOString() ?? null,
          });
        }
      }
      const unblockAt =
        [...waiting.values()]
          .map((o) => o.estimatedDelivery)
          .filter((d): d is string => d !== null)
          .sort()[0] ?? null;

      const tasks: BenchTask[] = project.tasks
        .filter((task) => !task.isCompleted)
        .map((task) => {
          const blocking = task.orders.find(
            (d) => !d.isDone && isIncomingOrderStatus(d.order.status),
          );
          const shortOf = task.components
            .filter((tc) => !tc.isDone && tc.component.quantity < tc.quantity)
            .map((tc) => tc.component.name);
          const state: BenchTaskState = blocking
            ? 'waitingOrder'
            : shortOf.length > 0
              ? 'noParts'
              : 'ready';
          return {
            id: task.id,
            title: task.title,
            priority: task.priority,
            dueDate: task.dueDate?.toISOString() ?? null,
            state,
            waitingFor: blocking
              ? {
                  storeName: blocking.order.storeName,
                  estimatedDelivery:
                    blocking.order.estimatedDelivery?.toISOString() ?? null,
                }
              : null,
            shortOf,
          };
        });

      const secured = countBy('reserved') + countBy('inStock');
      const total = lines.length;
      return {
        id: project.id,
        title: project.title,
        status: project.status,
        dueDate: project.dueDate?.toISOString() ?? null,
        lines,
        reserved: countBy('reserved'),
        inStock: countBy('inStock'),
        onOrder: countBy('onOrder'),
        missing: countBy('missing'),
        total,
        percent: total > 0 ? Math.round((secured / total) * 100) : 0,
        buildable: total > 0 && secured === total,
        unblockAt,
        waitingOn: [...waiting.values()],
        openTasks: tasks.length,
        tasks,
      };
    });

    // Closest to buildable first — the frontend's default focus.
    benchProjects.sort((a, b) => b.percent - a.percent);

    // Aggregate ribbon. buildable/notOrdered are ours; incoming/unplaced come
    // from other plugins' capabilities and stay null while that plugin is off.
    const incoming =
      this.capabilities.getCapability<LogisticsIncomingCapability>(
        LOGISTICS_INCOMING_CAPABILITY,
      );
    const stockFacts =
      this.capabilities.getCapability<InventoryStockFactsCapability>(
        INVENTORY_STOCK_FACTS_CAPABILITY,
      );
    const summary: BenchSummary = {
      buildable: benchProjects.filter((p) => p.buildable).length,
      notOrdered: benchProjects.reduce((sum, p) => sum + p.missing, 0),
      incoming: (await incoming?.incomingOrderCount()) ?? null,
      unplaced: (await stockFacts?.unplacedCount()) ?? null,
    };

    return { projects: benchProjects, summary };
  }

  async toggleTask(taskId: string, isCompleted: boolean) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { isCompleted },
    });
    // Task completion has no source timestamp of its own — log it (only the
    // false→true transition counts as an action).
    if (isCompleted)
      await this.recordActivity(task.projectId, 'task_completed');
    return task;
  }

  // The public fact "this project was closed" (#189/#192): entering the
  // terminal status, from whichever surface. Best-effort after the write
  // (#189 decision 9) — a failed enqueue is logged, never thrown.
  private async announceProjectClosed(project: {
    id: string;
    scopeId: string | null;
  }): Promise<void> {
    const publisher =
      this.capabilities.getCapability<ExternalEventsPublishCapability>(
        EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
      );
    if (!publisher) return;
    try {
      await publisher.publishDomainEvent({
        type: PROJECTS_PROJECT_CLOSED_EVENT,
        scopeId: project.scopeId,
        ref:
          formatObjectRef({
            pluginId: 'projects',
            entityType: 'project',
            entityId: project.id,
          }) ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `domain event ${PROJECTS_PROJECT_CLOSED_EVENT} not published: ${getErrorMessage(err)}`,
      );
    }
  }

  async create(data: {
    title: string;
    description?: string;
    status: string;
    startDate?: string | null;
    dueDate?: string | null;
    budgetPlanned?: number;
    budgetCurrency?: string;
    groupId?: string;
  }) {
    const id = 'proj_' + Math.random().toString(36).substring(2, 9);
    const groupId = data.groupId ?? (await this.groups.ensureDefaultGroupId());
    const project = await this.prisma.project.create({
      data: {
        id,
        groupId,
        title: data.title,
        description: sanitizeHtml(data.description),
        status: data.status,
        startDate: data.startDate ? new Date(data.startDate) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        // Born closed is stamped at birth (#294) — status is the only write
        // path for this column, and creation is one of its three entrances.
        completedAt: data.status === PROJECT_CLOSED_STATUS ? new Date() : null,
        budgetPlanned: data.budgetPlanned ?? null,
        budgetCurrency: data.budgetCurrency ?? 'USD',
      },
    });
    // Born closed is still closed — recording a finished build is a valid
    // way to close a project.
    if (project.status === PROJECT_CLOSED_STATUS) {
      await this.announceProjectClosed(project);
    }
    return project;
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      status?: string;
      startDate?: string | null;
      dueDate?: string | null;
      position?: number;
      budgetPlanned?: number;
      budgetCurrency?: string;
      groupId?: string;
    },
  ) {
    // The closed fact needs the transition, not the target: only a project
    // that was open and is now terminal gets announced.
    const before =
      data.status === undefined
        ? null
        : await this.prisma.project.findUnique({
            where: { id },
            select: { status: true },
          });
    // Each field is applied only when the caller sent it (undefined = leave as
    // is; null clears a date). Dates need conversion, so a raw spread of `data`
    // would hand Prisma the wrong shapes — build explicitly.
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(data.title === undefined ? {} : { title: data.title }),
        ...(data.description === undefined
          ? {}
          : { description: sanitizeHtml(data.description) }),
        ...(data.status === undefined ? {} : { status: data.status }),
        ...(data.startDate === undefined
          ? {}
          : { startDate: data.startDate ? new Date(data.startDate) : null }),
        ...(data.dueDate === undefined
          ? {}
          : { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
        ...(data.position === undefined ? {} : { position: data.position }),
        ...(data.budgetPlanned === undefined
          ? {}
          : { budgetPlanned: data.budgetPlanned }),
        ...(data.budgetCurrency === undefined
          ? {}
          : { budgetCurrency: data.budgetCurrency }),
        ...(data.groupId === undefined ? {} : { groupId: data.groupId }),
        ...closedStampPatch(before?.status, data.status),
      },
    });
    // Status changes are overwritten in place (no history row) — log the action.
    if (data.status !== undefined)
      await this.recordActivity(id, 'status_changed');
    if (
      before !== null &&
      before.status !== PROJECT_CLOSED_STATUS &&
      project.status === PROJECT_CLOSED_STATUS
    ) {
      await this.announceProjectClosed(project);
    }
    return project;
  }

  // Kanban reorder: assign each id its array index as position. When `movedId`
  // is given only that project changes status (the 3-bucket simple board groups
  // several statuses per column, #53); otherwise the whole column moves into
  // `status` (classic full board). Runs in a transaction so a drag never leaves
  // the column half-sorted. Scope enforcement still applies — the policy
  // filters each update by the caller's scope, so foreign ids match nothing.
  async reorderProjects(
    status: string,
    orderedIds: string[],
    movedId?: string,
  ): Promise<{ ok: true }> {
    // A drag into the terminal column closes cards that were open — capture
    // who was open BEFORE the transaction rewrites the column.
    const closingIds =
      status === PROJECT_CLOSED_STATUS
        ? await this.prisma.project.findMany({
            where: {
              id: { in: movedId === undefined ? orderedIds : [movedId] },
              status: { not: PROJECT_CLOSED_STATUS },
            },
            select: { id: true, scopeId: true },
          })
        : [];
    // A drag is the third write path for the closed stamp (#294). Into the
    // terminal column: stamp the cards that were actually open (a card already
    // closed keeps its original date — re-sorting a column is not re-closing
    // it). Out of it: clear, because a non-terminal project has no completion.
    const closingSet = new Set(closingIds.map((c) => c.id));
    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index++) {
        const id = orderedIds[index];
        const changesStatus = movedId === undefined || id === movedId;
        // The same rule as `closedStampPatch`, expressed against `closingSet`
        // instead of a per-card before-status: a drag has no per-card before,
        // and the one bulk query above is what stands in for it.
        const stamp: { completedAt?: Date | null } =
          status === PROJECT_CLOSED_STATUS
            ? // Already closed cards keep their date — re-sorting a column is
              // not re-closing it.
              closingSet.has(id)
              ? { completedAt: new Date() }
              : {}
            : { completedAt: null };
        await tx.project.update({
          where: { id },
          data: changesStatus
            ? { status, position: index, ...stamp }
            : { position: index },
        });
      }
    });
    // A single-card drag between columns is a board move worth counting; the
    // bulk full-column reorder (no movedId) is a sort, not a per-project action.
    if (movedId !== undefined)
      await this.recordActivity(movedId, 'board_moved');
    for (const closed of closingIds) {
      await this.announceProjectClosed(closed);
    }
    return { ok: true };
  }

  async delete(id: string) {
    return this.prisma.project.delete({
      where: { id },
    });
  }

  // Lightweight name lookup for confirmation summaries (ids → human names).
  async findComponent(id: string) {
    return this.prisma.component.findUnique({ where: { id } });
  }

  // One task with its owning project — used by the ORef resolver so a task
  // reference resolves to its title with the project as breadcrumb.
  async findTask(id: string) {
    return this.prisma.task.findUnique({
      where: { id },
      include: { project: true },
    });
  }

  async addTask(projectId: string, title: string) {
    const id = 't_' + Math.random().toString(36).substring(2, 9);
    return this.prisma.task.create({
      data: {
        id,
        projectId,
        title,
        description: '',
        priority: 'MEDIUM',
        isCompleted: false,
      },
    });
  }

  async deleteTask(taskId: string) {
    return this.prisma.task.delete({
      where: { id: taskId },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            components: {
              include: {
                component: true,
              },
            },
            orders: {
              include: {
                order: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        components: {
          include: {
            component: true,
          },
        },
      },
    });

    if (!project) return null;

    const componentIds = project.components.map((c) => c.componentId);

    // Orders are logistics data (#58): while the plugin is disabled the detail
    // payload reports none (its surfaces are hidden anyway).
    const relatedOrders = !this.pluginConfig.isEnabled('logistics')
      ? []
      : await this.prisma.order.findMany({
          where: {
            items: {
              some: {
                componentId: {
                  in: componentIds,
                },
              },
            },
          },
          include: {
            items: {
              include: {
                component: true,
              },
            },
          },
          orderBy: {
            orderDate: 'desc',
          },
        });

    const completedTasksCount = project.tasks.filter(
      (t) => t.isCompleted,
    ).length;
    const tasksCount = project.tasks.length;

    const formattedOrders = relatedOrders.map((o) => {
      const itemsCount = o.items.reduce((acc, item) => acc + item.quantity, 0);
      return {
        id: o.id,
        storeName: o.storeName,
        // Raw ISO (or null) — formatted on the frontend by the viewer's locale.
        orderDate: o.orderDate.toISOString(),
        status: o.status,
        trackingNumber: o.trackingNumber,
        trackingUrl: o.trackingUrl,
        estimatedDelivery: o.estimatedDelivery
          ? o.estimatedDelivery.toISOString()
          : null,
        totalCost: o.totalCost || 0,
        currency: o.currency ?? 'USD',
        itemsCount,
        items: o.items,
      };
    });

    const lastPrices = await this.lastUnitPriceByComponent();
    let actualBudget = 0;
    for (const pc of project.components) {
      actualBudget +=
        pc.reservedQty * (lastPrices.get(pc.componentId)?.price || 0);
    }
    const pendingOrders = relatedOrders.filter(
      (o) => o.status === 'ORDERED' || o.status === 'SHIPPED',
    );
    for (const o of pendingOrders) {
      for (const item of o.items) {
        if (componentIds.includes(item.componentId)) {
          actualBudget += item.quantity * (item.unitPrice || 0);
        }
      }
    }

    return {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      groupId: project.groupId,
      budgetPlanned: project.budgetPlanned,
      budgetCurrency: project.budgetCurrency,
      actualBudget: Number(actualBudget.toFixed(2)),
      tasksCount,
      completedTasksCount,
      componentsCount: project.components.length,
      // Raw ISO (or null) — formatted on the frontend by the viewer's locale.
      createdAt: project.createdAt.toISOString(),
      startDate: project.startDate?.toISOString() ?? null,
      dueDate: project.dueDate?.toISOString() ?? null,
      // Read-only outside the service (#294) — see closedStampPatch.
      completedAt: project.completedAt?.toISOString() ?? null,
      tasks: project.tasks,
      components: project.components,
      relatedOrders: formattedOrders,
    };
  }

  async linkComponent(
    projectId: string,
    componentId: string,
    neededQty: number,
  ) {
    const id = 'pc_' + Math.random().toString(36).substring(2, 9);

    const existing = await this.prisma.projectComponent.findFirst({
      where: { projectId, componentId },
    });

    if (existing) {
      return this.prisma.projectComponent.update({
        where: { id: existing.id },
        data: { neededQty },
      });
    }

    return this.prisma.projectComponent.create({
      data: {
        id,
        projectId,
        componentId,
        neededQty,
        reservedQty: 0,
      },
    });
  }

  async unlinkComponent(projectId: string, componentId: string) {
    const pc = await this.prisma.projectComponent.findFirst({
      where: { projectId, componentId },
    });

    if (!pc) return null;

    // Releasing an active reservation is inventory functionality (#58): the
    // inventory plugin listens and restores the units to free stock. While it
    // is disabled nothing tracks stock, so nothing else happens.
    if (pc.reservedQty > 0) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });
      await this.eventBus.emit<ProjectsComponentUnlinkedEvent>(
        PROJECTS_COMPONENT_UNLINKED_EVENT,
        {
          projectId,
          projectTitle:
            project?.title || this.i18n.t('projects.fallbacks.project'),
          componentId,
          reservedQty: pc.reservedQty,
        },
      );
    }

    return this.prisma.projectComponent.delete({
      where: { id: pc.id },
    });
  }

  async getTaskDetails(taskId: string) {
    return this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        components: {
          include: {
            component: true,
          },
        },
        orders: {
          include: {
            order: true,
          },
        },
      },
    });
  }

  async updateTask(
    taskId: string,
    data: {
      title?: string;
      description?: string;
      isCompleted?: boolean;
      priority?: string;
      dueDate?: string | null;
      componentIds?: { id: string; quantity: number; isDone?: boolean }[];
      orderIds?: { id: string; isDone?: boolean }[];
    },
  ) {
    if (data.componentIds) {
      await this.prisma.taskComponent.deleteMany({ where: { taskId } });
      for (const c of data.componentIds) {
        await this.prisma.taskComponent.create({
          data: {
            id: 'tc_' + Math.random().toString(36).substring(2, 9),
            taskId,
            componentId: c.id,
            quantity: c.quantity,
            isDone: c.isDone ?? false,
          },
        });
      }
    }

    if (data.orderIds) {
      await this.prisma.taskOrderDependency.deleteMany({ where: { taskId } });
      for (const o of data.orderIds) {
        await this.prisma.taskOrderDependency.create({
          data: {
            id: 'tod_' + Math.random().toString(36).substring(2, 9),
            taskId,
            orderId: o.id,
            isDone: o.isDone ?? false,
          },
        });
      }
    }

    // 3. Update task properties. Completion has no source timestamp — when this
    // update flips isCompleted false→true, log it as an activity action (the
    // HTTP checkbox toggle comes through here, not toggleTask).
    const prev =
      data.isCompleted === true
        ? await this.prisma.task.findUnique({
            where: { id: taskId },
            select: { isCompleted: true },
          })
        : null;
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: data.title,
        description:
          data.description === undefined
            ? undefined
            : sanitizeHtml(data.description),
        isCompleted: data.isCompleted,
        priority: data.priority,
        ...(data.dueDate === undefined
          ? {}
          : { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
      },
    });
    if (prev && !prev.isCompleted && updated.isCompleted) {
      await this.recordActivity(updated.projectId, 'task_completed');
    }
    return updated;
  }

  // Stats provider for the `projects.activity` metric (ticket #54): per-day
  // project-action counts, dimensioned by projectId. Called by the stats
  // aggregation job inside a systemBypass context (all scopes at once), so each
  // point carries its owning scopeId. HYBRID source: most actions are derived
  // from the source tables' own timestamps (so history backfills without an
  // event log), plus the ActivityEvent log for actions that leave no timestamp
  // (task completed / status changed / board moved). No double counting — the
  // log holds only the un-dateable kinds.
  async getActivityCountsByDayScope(
    from: Date,
    to: Date,
  ): Promise<StatsPoint[]> {
    const range = { gte: from, lt: to };
    const withProject = { projectId: { not: null } } as const;

    const [tasks, movements, attachments, orders, projects, events] =
      await Promise.all([
        this.prisma.task.findMany({
          where: { createdAt: range },
          select: {
            createdAt: true,
            projectId: true,
            project: { select: { scopeId: true } },
          },
        }),
        this.prisma.stockMovement.findMany({
          where: { createdAt: range, ...withProject },
          select: { createdAt: true, projectId: true, scopeId: true },
        }),
        this.prisma.attachment.findMany({
          where: { createdAt: range, ...withProject },
          select: { createdAt: true, projectId: true, scopeId: true },
        }),
        this.prisma.order.findMany({
          where: { orderDate: range, ...withProject },
          select: { orderDate: true, projectId: true, scopeId: true },
        }),
        this.prisma.project.findMany({
          where: { createdAt: range },
          select: { createdAt: true, id: true, scopeId: true },
        }),
        this.prisma.activityEvent.findMany({
          where: { createdAt: range },
          select: { createdAt: true, projectId: true, scopeId: true },
        }),
      ]);

    const isoDay = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    // Bucket by (day, scopeId, projectId). The value is a running action count;
    // the projectId becomes the point's dimension so the series API can split or
    // sum across projects.
    const buckets = new Map<string, StatsPoint>();
    const tally = (
      when: Date,
      projectId: string | null,
      scopeId: string | null,
    ): void => {
      if (!projectId) return;
      const date = isoDay(when);
      const key = `${date} ${scopeId ?? ''} ${projectId}`;
      const existing = buckets.get(key);
      if (existing) existing.value += 1;
      else
        buckets.set(key, {
          date,
          scopeId,
          value: 1,
          dimensions: { projectId },
        });
    };

    for (const t of tasks)
      tally(t.createdAt, t.projectId, t.project?.scopeId ?? null);
    for (const m of movements) tally(m.createdAt, m.projectId, m.scopeId);
    for (const a of attachments) tally(a.createdAt, a.projectId, a.scopeId);
    for (const o of orders) tally(o.orderDate, o.projectId, o.scopeId);
    for (const p of projects) tally(p.createdAt, p.id, p.scopeId);
    for (const e of events) tally(e.createdAt, e.projectId, e.scopeId);

    return [...buckets.values()];
  }
}
