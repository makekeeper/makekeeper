import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  PrismaService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
  INVENTORY_ITEM_CHANGED_EVENT,
  INVENTORY_ITEM_CREATED_EVENT,
  INVENTORY_ITEM_DELETED_EVENT,
  formatObjectRef,
  type ExternalDomainEventInput,
  type ExternalEventsPublishCapability,
} from '@makekeeper/plugin-contract';

// The inventory plugin's publishing seam for the PUBLIC domain-event
// catalogue (#189/#192). One place instead of scattered capability lookups,
// because two services mutate items: the CRUD service and the stock service.
//
// Publication is best-effort after the domain write (#189 decision 9): a
// failure to enqueue must never fail the mutation the user asked for — it is
// logged and the subscriber catches up from the next event or a re-read.
@Injectable()
export class InventoryEventsService {
  private readonly logger = new Logger(InventoryEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  async itemCreated(item: {
    id: string;
    scopeId: string | null;
  }): Promise<void> {
    await this.publish({
      type: INVENTORY_ITEM_CREATED_EVENT,
      scopeId: item.scopeId,
      ref: this.itemRef(item.id),
    });
  }

  // `scopeId` is optional because the stock service adjusts quantities by id
  // only; the scope is then read back from the row.
  async itemChanged(
    itemId: string,
    changed: string[],
    scopeId?: string | null,
  ): Promise<void> {
    // Resolve the capability BEFORE the extra scope read — with no external
    // host there must be no cost at all on the hot stock paths.
    if (!this.publisher()) return;
    let scope = scopeId;
    if (scope === undefined) {
      const row = await this.prisma.component.findUnique({
        where: { id: itemId },
        select: { scopeId: true },
      });
      if (!row) return;
      scope = row.scopeId;
    }
    await this.publish({
      type: INVENTORY_ITEM_CHANGED_EVENT,
      scopeId: scope,
      ref: this.itemRef(itemId),
      changed,
    });
  }

  async itemDeleted(item: {
    id: string;
    scopeId: string | null;
  }): Promise<void> {
    await this.publish({
      type: INVENTORY_ITEM_DELETED_EVENT,
      scopeId: item.scopeId,
      ref: this.itemRef(item.id),
    });
  }

  private publisher(): ExternalEventsPublishCapability | null {
    return this.capabilities.getCapability<ExternalEventsPublishCapability>(
      EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
    );
  }

  // The ORef entity type is `component` — the historical Prisma/ORef name the
  // resolvers already answer to — even though the event vocabulary says
  // "item", the product noun (#71).
  private itemRef(itemId: string): string | undefined {
    return (
      formatObjectRef({
        pluginId: 'inventory',
        entityType: 'component',
        entityId: itemId,
      }) ?? undefined
    );
  }

  private async publish(input: ExternalDomainEventInput): Promise<void> {
    const publisher = this.publisher();
    if (!publisher) return;
    try {
      await publisher.publishDomainEvent(input);
    } catch (err) {
      this.logger.warn(
        `domain event ${input.type} not published: ${getErrorMessage(err)}`,
      );
    }
  }
}
