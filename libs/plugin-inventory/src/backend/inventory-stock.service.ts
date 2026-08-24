import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  generateUuid,
} from '@makekeeper/backend-core';
import type { ProjectComponent } from '@prisma/client';
import type {
  LogisticsStockAdjustEvent,
  ProjectsComponentUnlinkedEvent,
} from '@makekeeper/plugin-contract';
import { InventoryEventsService } from './inventory-events.service';

// Physical-stock operations around projects and orders (#58). This logic used
// to live inside the projects/logistics services; it is inventory
// functionality (it maintains `Component.quantity` and the `StockMovement`
// ledger), so it belongs to the inventory plugin: its HTTP surface 404s and
// its event listeners go silent the moment inventory is disabled — the rest
// of the app keeps working without stock tracking. Reading/writing the BOM's
// `reservedQty` (a projects model) is fine: projects is a core plugin.
@Injectable()
export class InventoryStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly events: InventoryEventsService,
  ) {}

  // Public: the agent tools' confirm summaries also need the display title.
  async projectTitle(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    return project?.title || this.i18n.t('inventory.stock.fallbackProject');
  }

  // Reserve free stock for a project's BOM line (qty > 0) or release part of a
  // reservation back to free stock (qty < 0).
  async reserveForProject(
    projectId: string,
    componentId: string,
    qty: number,
  ): Promise<ProjectComponent> {
    const pc = await this.prisma.projectComponent.findFirst({
      where: { projectId, componentId },
      include: { component: true },
    });
    if (!pc)
      throw new Error(this.i18n.t('inventory.stock.errors.linkNotFound'));

    const projectTitle = await this.projectTitle(projectId);

    if (qty > 0) {
      if (pc.component.quantity < qty) {
        throw new Error(
          this.i18n.t('inventory.stock.errors.insufficientStock', {
            available: pc.component.quantity,
          }),
        );
      }

      const deficit = pc.neededQty - pc.reservedQty;
      if (qty > deficit) {
        throw new Error(
          this.i18n.t('inventory.stock.errors.reserveExceedsNeed', { deficit }),
        );
      }

      await this.prisma.component.update({
        where: { id: componentId },
        data: { quantity: pc.component.quantity - qty },
      });
      await this.prisma.stockMovement.create({
        data: {
          id: generateUuid(),
          componentId,
          delta: -qty,
          type: 'RESERVED',
          projectId,
          note: this.i18n.t('inventory.stock.notes.reserved', { projectTitle }),
        },
      });
      await this.events.itemChanged(componentId, ['quantity']);
      return this.prisma.projectComponent.update({
        where: { id: pc.id },
        data: { reservedQty: pc.reservedQty + qty },
      });
    } else if (qty < 0) {
      const unreserveQty = Math.abs(qty);
      if (pc.reservedQty < unreserveQty) {
        throw new Error(
          this.i18n.t('inventory.stock.errors.unreserveExceedsReserved', {
            reserved: pc.reservedQty,
          }),
        );
      }

      await this.prisma.component.update({
        where: { id: componentId },
        data: { quantity: pc.component.quantity + unreserveQty },
      });
      await this.prisma.stockMovement.create({
        data: {
          id: generateUuid(),
          componentId,
          delta: unreserveQty,
          type: 'RESERVED',
          projectId,
          note: this.i18n.t('inventory.stock.notes.unreserved', {
            projectTitle,
          }),
        },
      });
      await this.events.itemChanged(componentId, ['quantity']);
      return this.prisma.projectComponent.update({
        where: { id: pc.id },
        data: { reservedQty: pc.reservedQty - unreserveQty },
      });
    }

    return pc;
  }

  // Consume reserved stock into the project: the parts leave inventory for good.
  // Reservation already removed them from the component's free `quantity`, so
  // consuming only draws down `reservedQty` and records a USED movement — it does
  // NOT touch `quantity` again (that would double-count). Total holdings
  // (quantity + reserved) drop by qty, reflected as the movement's negative delta.
  async consumeForProject(
    projectId: string,
    componentId: string,
    qty: number,
  ): Promise<ProjectComponent> {
    if (qty <= 0) {
      throw new Error(this.i18n.t('inventory.stock.errors.mustBePositive'));
    }

    const pc = await this.prisma.projectComponent.findFirst({
      where: { projectId, componentId },
    });
    if (!pc)
      throw new Error(this.i18n.t('inventory.stock.errors.linkNotFound'));
    if (pc.reservedQty < qty) {
      throw new Error(
        this.i18n.t('inventory.stock.errors.consumeExceedsReserved', {
          reserved: pc.reservedQty,
        }),
      );
    }

    const projectTitle = await this.projectTitle(projectId);

    await this.prisma.stockMovement.create({
      data: {
        id: generateUuid(),
        componentId,
        delta: -qty,
        type: 'USED',
        projectId,
        note: this.i18n.t('inventory.stock.notes.used', { projectTitle }),
      },
    });
    return this.prisma.projectComponent.update({
      where: { id: pc.id },
      data: { reservedQty: pc.reservedQty - qty },
    });
  }

  // Return unused reserved stock to free inventory: reverse of a reservation.
  // `reservedQty` drops and the component's free `quantity` grows back by qty,
  // recorded as a RETURN movement. Total holdings are unchanged.
  async returnForProject(
    projectId: string,
    componentId: string,
    qty: number,
  ): Promise<ProjectComponent> {
    if (qty <= 0) {
      throw new Error(this.i18n.t('inventory.stock.errors.mustBePositive'));
    }

    const pc = await this.prisma.projectComponent.findFirst({
      where: { projectId, componentId },
      include: { component: true },
    });
    if (!pc)
      throw new Error(this.i18n.t('inventory.stock.errors.linkNotFound'));
    if (pc.reservedQty < qty) {
      throw new Error(
        this.i18n.t('inventory.stock.errors.consumeExceedsReserved', {
          reserved: pc.reservedQty,
        }),
      );
    }

    const projectTitle = await this.projectTitle(projectId);

    await this.prisma.component.update({
      where: { id: componentId },
      data: { quantity: pc.component.quantity + qty },
    });
    await this.prisma.stockMovement.create({
      data: {
        id: generateUuid(),
        componentId,
        delta: qty,
        type: 'RETURN',
        projectId,
        note: this.i18n.t('inventory.stock.notes.returned', { projectTitle }),
      },
    });
    await this.events.itemChanged(componentId, ['quantity']);
    return this.prisma.projectComponent.update({
      where: { id: pc.id },
      data: { reservedQty: pc.reservedQty - qty },
    });
  }

  // Listener for `logistics.stock.adjust` (#58): applies an order-driven stock
  // delta to the component and the ledger. When stock is being ADDED and the
  // order has a destination storage, a component with no placement yet inherits
  // it (fill-if-empty only — an already-placed component is never moved).
  async applyLogisticsAdjustment(
    event: LogisticsStockAdjustEvent,
  ): Promise<void> {
    await this.prisma.component.update({
      where: { id: event.componentId },
      data: { quantity: { increment: event.delta } },
    });
    await this.prisma.stockMovement.create({
      data: {
        id: generateUuid(),
        componentId: event.componentId,
        delta: event.delta,
        type: event.movementType,
        orderId: event.orderId,
        note: event.note,
      },
    });
    let placed = false;
    if (event.delta > 0 && event.destinationStorageId) {
      const component = await this.prisma.component.findUnique({
        where: { id: event.componentId },
        select: { storageId: true },
      });
      if (component && component.storageId === null) {
        await this.prisma.component.update({
          where: { id: event.componentId },
          data: { storageId: event.destinationStorageId },
        });
        placed = true;
      }
    }
    await this.events.itemChanged(
      event.componentId,
      placed ? ['quantity', 'storageId'] : ['quantity'],
    );
  }

  // Listener for `projects.component.unlinked` (#58): a removed BOM link with
  // an active reservation releases those units back to free stock.
  async releaseUnlinkedReservation(
    event: ProjectsComponentUnlinkedEvent,
  ): Promise<void> {
    const component = await this.prisma.component.findUnique({
      where: { id: event.componentId },
    });
    if (!component) return;
    await this.prisma.component.update({
      where: { id: event.componentId },
      data: { quantity: component.quantity + event.reservedQty },
    });
    await this.prisma.stockMovement.create({
      data: {
        id: generateUuid(),
        componentId: event.componentId,
        delta: event.reservedQty,
        type: 'RESERVED',
        projectId: event.projectId,
        note: this.i18n.t('inventory.stock.notes.unreservedUnlink', {
          projectTitle: event.projectTitle,
        }),
      },
    });
    await this.events.itemChanged(event.componentId, ['quantity']);
  }
}
