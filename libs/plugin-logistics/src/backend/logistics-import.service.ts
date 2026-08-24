import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  AttachmentStorageService,
  CapabilityRegistryService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  VISION_COMPLETION_CAPABILITY,
  type VisionCompletionCapability,
} from '@makekeeper/plugin-contract';

// A single extracted line, with an optional match to an existing component.
export interface ImportedItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  matchedComponentId: string | null;
}

// The reviewable draft returned to the UI — never persisted here; the user
// reviews and confirms it through the normal create-order flow.
export interface OrderDraft {
  storeName: string;
  currency: string;
  totalCost: number;
  trackingNumber: string;
  orderDate: string;
  items: ImportedItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Normalizes a name for fuzzy matching: lowercase, strip non-alphanumerics.
const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9а-я]+/gi, '');

@Injectable()
export class LogisticsImportService {
  private readonly logger = new Logger(LogisticsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly attachments: AttachmentStorageService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  async importOrderFromImage(
    input: { imageDataUrl?: string; imageUrl?: string },
    locale?: string,
  ): Promise<OrderDraft> {
    // Resolve to a "/api/uploads/:id" URL the vision path can read. A pasted/
    // uploaded data URL is persisted (auto-scoped by the request); a capture
    // photo already comes as an uploads URL.
    let url: string | null = null;
    if (input.imageDataUrl?.startsWith('data:')) {
      url = await this.attachments.saveDataUrl(
        { pluginId: 'logistics' },
        input.imageDataUrl,
      );
    } else if (input.imageUrl) {
      url = input.imageUrl;
    }
    if (!url) {
      throw new Error(
        this.i18n.t('logistics.errors.importNoImage', undefined, locale),
      );
    }

    const systemPrompt = this.i18n.t(
      'logistics.prompt.importSystem',
      undefined,
      locale,
    );
    const userText = this.i18n.t(
      'logistics.prompt.importUser',
      undefined,
      locale,
    );

    // Resolved per call through the capability registry (#58): null while the
    // chat plugin is disabled (or absent) — the import feature then simply
    // doesn't exist, without logistics importing chat's code.
    const vision = this.capabilities.getCapability<VisionCompletionCapability>(
      VISION_COMPLETION_CAPABILITY,
    );
    if (!vision) {
      throw new Error(
        this.i18n.t('logistics.errors.importUnavailable', undefined, locale),
      );
    }
    // One screenshot, in the list form the capability now takes (#215). An order
    // confirmation is a single page; there is nothing here to shoot from another
    // angle.
    const raw = await vision.runVisionCompletion(
      systemPrompt,
      userText,
      [url],
      locale,
    );
    if (raw === null) {
      throw new Error(
        this.i18n.t('logistics.errors.importNoProvider', undefined, locale),
      );
    }

    const parsed = this.parseDraft(raw);
    if (!parsed) {
      throw new Error(
        this.i18n.t('logistics.errors.importParseFailed', undefined, locale),
      );
    }

    // Fuzzy-match each extracted line to an existing component (name or SKU).
    const components = await this.prisma.component.findMany({
      select: { id: true, name: true, sku: true },
    });
    const items: ImportedItem[] = parsed.items.map((it) => ({
      ...it,
      matchedComponentId: this.matchComponent(it, components),
    }));

    return { ...parsed, items };
  }

  // Tolerant JSON parse: strips markdown fences and any prose around the object,
  // then validates the shape defensively. Returns null on anything unusable.
  private parseDraft(raw: string):
    | (Omit<OrderDraft, 'items'> & {
        items: Omit<ImportedItem, 'matchedComponentId'>[];
      })
    | null {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    let json: unknown;
    try {
      json = JSON.parse(text.slice(start, end + 1));
    } catch (err) {
      this.logger.warn(`Import parse failed: ${getErrorMessage(err)}`);
      return null;
    }
    if (!isRecord(json)) return null;

    const rawItems = Array.isArray(json.items) ? json.items : [];
    const items = rawItems.filter(isRecord).map((it) => ({
      name: asString(it.name),
      sku: typeof it.sku === 'string' && it.sku ? it.sku : null,
      quantity: Math.max(1, Math.round(asNumber(it.quantity) || 1)),
      unitPrice: Math.max(0, asNumber(it.unitPrice)),
    }));

    return {
      storeName: asString(json.storeName),
      currency: asString(json.currency) || 'USD',
      totalCost: Math.max(0, asNumber(json.totalCost)),
      trackingNumber: asString(json.trackingNumber),
      orderDate: asString(json.orderDate),
      items,
    };
  }

  private matchComponent(
    item: { name: string; sku: string | null },
    components: { id: string; name: string; sku: string | null }[],
  ): string | null {
    const itemSku = item.sku ? normalize(item.sku) : '';
    if (itemSku) {
      const bySku = components.find(
        (c) => c.sku && normalize(c.sku) === itemSku,
      );
      if (bySku) return bySku.id;
    }
    const itemName = normalize(item.name);
    if (!itemName) return null;
    const byName = components.find((c) => {
      const cn = normalize(c.name);
      return cn === itemName || cn.includes(itemName) || itemName.includes(cn);
    });
    return byName ? byName.id : null;
  }
}
