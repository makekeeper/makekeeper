import {
  AgentTool,
  PermissionLevel,
  resolveEntityId,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { LogisticsService } from './logistics.service';
import { LogisticsTrackingService } from './logistics-tracking.service';
import { LogisticsImportService } from './logistics-import.service';
import { OrderStatus } from './logistics.dto';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// A batch line's quantity for the confirmation preview (#72): a finite number
// renders as-is; anything unparseable is omitted (the line still shows its name)
// so a malformed count never surfaces as a literal "NaN" on the card.
const qtyLabel = (value: unknown): string | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : undefined;
};

export const getLogisticsTools = (
  logisticsService: LogisticsService,
  trackingService: LogisticsTrackingService,
  importService: LogisticsImportService,
): AgentTool[] =>
  withPlugin('logistics', 'plugins.logistics.name', [
    // ── READ ──────────────────────────────────────────────────────────────────

    {
      name: 'list_orders',
      descriptionKey: 'logistics.agentTools.list_orders.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => logisticsService.findAllOrders(),
    },

    {
      name: 'get_shopping_list',
      descriptionKey: 'logistics.agentTools.get_shopping_list.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => logisticsService.getShoppingList(),
    },

    // ── WRITE ─────────────────────────────────────────────────────────────────

    {
      name: 'create_order',
      descriptionKey: 'logistics.agentTools.create_order.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          storeName: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.storeName',
          },
          trackingNumber: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.trackingNumber',
          },
          trackingUrl: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.trackingUrl',
          },
          estimatedDelivery: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.estimatedDelivery',
          },
          totalCost: {
            type: 'number',
            descriptionKey:
              'logistics.agentTools.create_order.params.totalCost',
          },
          currency: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.create_order.params.currency',
          },
          supplierId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.supplierId',
          },
          projectId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.projectId',
          },
          storageId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_order.params.storageId',
          },
          items: {
            type: 'array',
            descriptionKey: 'logistics.agentTools.create_order.params.items',
            items: {
              type: 'object',
              descriptionKey:
                'logistics.agentTools.create_order.params.itemsItem',
            },
          },
        },
        required: ['storeName', 'items'],
      },
      confirmSummary: async (args) => {
        const items = Array.isArray(args.items)
          ? args.items.filter(isRecord)
          : [];
        // Itemized preview (#72): resolve each componentId → name so a batch
        // parsed from a photo is verified line by line, not as a bare count.
        const names = await logisticsService.componentNames(
          items.map((item) => String(item.componentId)),
        );
        return {
          key: 'agentConfirm.create_order',
          params: {
            store: String(args.storeName),
            count: String(items.length),
          },
          lines: items.map((item) => {
            const id = String(item.componentId);
            return { text: names.get(id) ?? id, qty: qtyLabel(item.quantity) };
          }),
        };
      },
      handler: async (args) =>
        logisticsService.createOrder({
          storeName: String(args.storeName),
          trackingNumber:
            args.trackingNumber === undefined
              ? undefined
              : String(args.trackingNumber),
          trackingUrl:
            args.trackingUrl === undefined
              ? undefined
              : String(args.trackingUrl),
          estimatedDelivery:
            args.estimatedDelivery === undefined
              ? undefined
              : String(args.estimatedDelivery),
          totalCost:
            args.totalCost === undefined ? undefined : Number(args.totalCost),
          currency:
            args.currency === undefined ? undefined : String(args.currency),
          supplierId:
            args.supplierId === undefined ? undefined : String(args.supplierId),
          projectId:
            args.projectId === undefined ? undefined : String(args.projectId),
          // Accepts a raw id or a canonical `mk://storages/storage/...` ORef
          // (§5.9); root-only is validated in the service.
          storageId:
            args.storageId === undefined
              ? undefined
              : (resolveEntityId(String(args.storageId), {
                  pluginId: 'storages',
                  entityType: 'storage',
                })?.id ?? String(args.storageId)),
          items: Array.isArray(args.items)
            ? args.items.filter(isRecord).map((item) => ({
                componentId: String(item.componentId),
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
              }))
            : [],
        }),
    },

    {
      name: 'update_order_status',
      descriptionKey: 'logistics.agentTools.update_order_status.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_order_status.params.orderId',
          },
          status: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_order_status.params.status',
          },
        },
        required: ['orderId', 'status'],
      },
      confirmSummary: async (args) => {
        const order = await logisticsService.findOrder(String(args.orderId));
        return {
          key: 'agentConfirm.update_order_status',
          params: {
            store: order?.storeName ?? String(args.orderId),
            status: String(args.status),
          },
        };
      },
      handler: async (args) =>
        logisticsService.updateStatus(
          String(args.orderId),
          String(args.status) as OrderStatus,
        ),
    },

    // ── DESTRUCTIVE ───────────────────────────────────────────────────────────

    {
      name: 'delete_order',
      descriptionKey: 'logistics.agentTools.delete_order.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.delete_order.params.orderId',
          },
        },
        required: ['orderId'],
      },
      confirmSummary: async (args) => {
        const order = await logisticsService.findOrder(String(args.orderId));
        return {
          key: 'agentConfirm.delete_order',
          params: { store: order?.storeName ?? String(args.orderId) },
        };
      },
      handler: async (args) =>
        logisticsService.deleteOrder(String(args.orderId)),
    },

    // ── Suppliers ─────────────────────────────────────────────────────────────

    {
      name: 'list_suppliers',
      descriptionKey: 'logistics.agentTools.list_suppliers.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => logisticsService.findAllSuppliers(),
    },

    {
      name: 'create_supplier',
      descriptionKey: 'logistics.agentTools.create_supplier.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.create_supplier.params.name',
          },
          url: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.create_supplier.params.url',
          },
          country: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_supplier.params.country',
          },
          trackingUrlTemplate: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_supplier.params.trackingUrlTemplate',
          },
          notes: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.create_supplier.params.notes',
          },
        },
        required: ['name'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.create_supplier',
        params: { name: String(args.name) },
      }),
      handler: async (args) =>
        logisticsService.createSupplier({
          name: String(args.name),
          url: args.url === undefined ? undefined : String(args.url),
          country:
            args.country === undefined ? undefined : String(args.country),
          trackingUrlTemplate:
            args.trackingUrlTemplate === undefined
              ? undefined
              : String(args.trackingUrlTemplate),
          notes: args.notes === undefined ? undefined : String(args.notes),
        }),
    },

    {
      name: 'update_supplier',
      descriptionKey: 'logistics.agentTools.update_supplier.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          supplierId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_supplier.params.supplierId',
          },
          name: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.update_supplier.params.name',
          },
          url: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.update_supplier.params.url',
          },
          country: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_supplier.params.country',
          },
          trackingUrlTemplate: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_supplier.params.trackingUrlTemplate',
          },
          notes: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.update_supplier.params.notes',
          },
        },
        required: ['supplierId', 'name'],
      },
      confirmSummary: async (args) => {
        const supplier = await logisticsService.findSupplier(
          String(args.supplierId),
        );
        return {
          key: 'agentConfirm.update_supplier',
          params: { name: supplier?.name ?? String(args.name) },
        };
      },
      handler: async (args) =>
        logisticsService.updateSupplier(String(args.supplierId), {
          name: String(args.name),
          url: args.url === undefined ? undefined : String(args.url),
          country:
            args.country === undefined ? undefined : String(args.country),
          trackingUrlTemplate:
            args.trackingUrlTemplate === undefined
              ? undefined
              : String(args.trackingUrlTemplate),
          notes: args.notes === undefined ? undefined : String(args.notes),
        }),
    },

    {
      name: 'delete_supplier',
      descriptionKey: 'logistics.agentTools.delete_supplier.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          supplierId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.delete_supplier.params.supplierId',
          },
        },
        required: ['supplierId'],
      },
      confirmSummary: async (args) => {
        const supplier = await logisticsService.findSupplier(
          String(args.supplierId),
        );
        return {
          key: 'agentConfirm.delete_supplier',
          params: { name: supplier?.name ?? String(args.supplierId) },
        };
      },
      handler: async (args) =>
        logisticsService.deleteSupplier(String(args.supplierId)),
    },

    // ── Tracking ──────────────────────────────────────────────────────────────

    {
      name: 'get_tracking',
      descriptionKey: 'logistics.agentTools.get_tracking.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.get_tracking.params.orderId',
          },
        },
        required: ['orderId'],
      },
      handler: async (args) => trackingService.getEvents(String(args.orderId)),
    },

    {
      name: 'refresh_tracking',
      descriptionKey: 'logistics.agentTools.refresh_tracking.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.refresh_tracking.params.orderId',
          },
        },
        required: ['orderId'],
      },
      confirmSummary: async (args) => {
        const order = await logisticsService.findOrder(String(args.orderId));
        return {
          key: 'agentConfirm.refresh_tracking',
          params: { store: order?.storeName ?? String(args.orderId) },
        };
      },
      handler: async (args) =>
        trackingService.refreshOrder(String(args.orderId)),
    },

    // ── Receiving & returns ─────────────────────────────────────────────────

    {
      name: 'receive_order_items',
      descriptionKey: 'logistics.agentTools.receive_order_items.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.receive_order_items.params.orderId',
          },
          lines: {
            type: 'array',
            descriptionKey:
              'logistics.agentTools.receive_order_items.params.lines',
            items: {
              type: 'object',
              descriptionKey:
                'logistics.agentTools.receive_order_items.params.linesItem',
            },
          },
        },
        required: ['orderId', 'lines'],
      },
      confirmSummary: async (args) => {
        const order = await logisticsService.findOrder(String(args.orderId));
        const lines = Array.isArray(args.lines)
          ? args.lines.filter(isRecord)
          : [];
        // Itemized receipt preview (#72): resolve each order line → component
        // name so "receive 70" reads as a concrete row, not a silent write.
        const names = await logisticsService.orderLineNames(
          String(args.orderId),
          lines.map((line) => String(line.orderComponentId)),
        );
        return {
          key: 'agentConfirm.receive_order_items',
          params: { store: order?.storeName ?? String(args.orderId) },
          lines: lines.map((line) => {
            const id = String(line.orderComponentId);
            return {
              text: names.get(id) ?? id,
              qty: qtyLabel(line.receivedQty),
            };
          }),
        };
      },
      handler: async (args) =>
        logisticsService.receiveOrder(
          String(args.orderId),
          Array.isArray(args.lines)
            ? args.lines.filter(isRecord).map((l) => ({
                orderComponentId: String(l.orderComponentId),
                receivedQty: Number(l.receivedQty),
              }))
            : [],
        ),
    },

    {
      name: 'list_returns',
      descriptionKey: 'logistics.agentTools.list_returns.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.list_returns.params.orderId',
          },
        },
        required: [],
      },
      handler: async (args) =>
        logisticsService.findReturns(
          args.orderId === undefined ? undefined : String(args.orderId),
        ),
    },

    {
      name: 'create_return',
      descriptionKey: 'logistics.agentTools.create_return.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.create_return.params.orderId',
          },
          componentId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_return.params.componentId',
          },
          quantity: {
            type: 'number',
            descriptionKey:
              'logistics.agentTools.create_return.params.quantity',
          },
          reason: {
            type: 'string',
            descriptionKey: 'logistics.agentTools.create_return.params.reason',
          },
          trackingNumber: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.create_return.params.trackingNumber',
          },
        },
        required: ['orderId', 'quantity'],
      },
      confirmSummary: async (args) => {
        const order = await logisticsService.findOrder(String(args.orderId));
        return {
          key: 'agentConfirm.create_return',
          params: { store: order?.storeName ?? String(args.orderId) },
        };
      },
      handler: async (args) =>
        logisticsService.createReturn({
          orderId: String(args.orderId),
          componentId:
            args.componentId === undefined
              ? undefined
              : String(args.componentId),
          quantity: Number(args.quantity),
          reason: args.reason === undefined ? undefined : String(args.reason),
          trackingNumber:
            args.trackingNumber === undefined
              ? undefined
              : String(args.trackingNumber),
        }),
    },

    {
      name: 'update_return_status',
      descriptionKey: 'logistics.agentTools.update_return_status.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          returnId: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_return_status.params.returnId',
          },
          status: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.update_return_status.params.status',
          },
        },
        required: ['returnId', 'status'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.update_return_status',
        params: { status: String(args.status) },
      }),
      handler: async (args) =>
        logisticsService.updateReturnStatus(
          String(args.returnId),
          String(args.status),
        ),
    },

    {
      name: 'import_order_from_image',
      descriptionKey:
        'logistics.agentTools.import_order_from_image.description',
      // Parses a photo into a reviewable order *draft* — it persists no order,
      // so it is a READ that auto-runs. The write that follows (`create_order`)
      // is the gated step, and carries the itemized line preview the user checks
      // before anything is stored (#72). Gating here too would only add a blind,
      // numberless second confirmation ahead of the real, previewed one.
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          imageUrl: {
            type: 'string',
            descriptionKey:
              'logistics.agentTools.import_order_from_image.params.imageUrl',
          },
        },
        required: ['imageUrl'],
      },
      handler: async (args) =>
        importService.importOrderFromImage({ imageUrl: String(args.imageUrl) }),
    },
  ]);
