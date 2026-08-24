import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  AttachmentStorageService,
  CapabilityRegistryService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  TEXT_COMPLETION_CAPABILITY,
  VISION_COMPLETION_CAPABILITY,
  type TextCompletionCapability,
  type VisionCompletionCapability,
} from '@makekeeper/plugin-contract';
import type { IntakeCandidate, RecognizedItemDraft } from '../mobile-intake';
import { coercePropertyValue, type EffectiveProperty } from '../categories';
import { InventoryCategoriesService } from './categories.service';

// Turning a photo into a filled-in form (#200).
//
// What this deliberately is NOT: a writer. The model's output prefills a form
// and a human presses save, so the write is an ordinary POST with no agent tool
// and no confirmation gate in the path. That is the whole reason the #72
// provenance machinery does not appear here — there is no autonomous write to
// gate.
//
// It is also not the first thing tried. The camera reads barcodes locally, and
// an exact SKU hit answers "which part is this" for free and exactly; the model
// is the fallback for a part whose packaging has no code left on it.

// How many name-similar components to offer as "did you mean". Enough to
// recognize the right one at a glance on a phone, few enough not to scroll.
const MAX_CANDIDATES = 5;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const asOptionalString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

// Same normalization the order import uses, for the same reason: humans and
// vendors punctuate part names differently every single time.
const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9а-я]+/gi, '');

@Injectable()
export class InventoryRecognitionService {
  private readonly logger = new Logger(InventoryRecognitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly attachments: AttachmentStorageService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly categories: InventoryCategoriesService,
  ) {}

  // Whether recognition can run at all right now. The mobile surface asks before
  // showing the button: with the AI Assistant plugin disabled, absent, or
  // outside this user's set, the capability resolves to null and the feature
  // simply is not there — scanning and manual entry are unaffected.
  isAvailable(): boolean {
    return (
      this.capabilities.getCapability<VisionCompletionCapability>(
        VISION_COMPLETION_CAPABILITY,
      ) !== null
    );
  }

  // Persist a photo so it can be recognized later (and attached to the item that
  // comes out of it) without re-uploading the bytes. Split out for the conveyor
  // (#201), where storing and recognizing happen minutes apart.
  //
  // Parentless: this is the single-item scenario, where the frames are held
  // loose until the person saves the item (#217). The conveyor's frames belong
  // to a draft — see `storeFrame`.
  async storePhoto(imageDataUrl: string, locale?: string): Promise<string> {
    const imageUrl = await this.attachments.saveDataUrl(
      { pluginId: 'inventory' },
      imageDataUrl,
    );
    if (!imageUrl) {
      throw new Error(
        this.i18n.t('inventory.errors.recognizeNoImage', undefined, locale),
      );
    }
    return imageUrl;
  }

  // One frame OF A DRAFT (#216). Same bytes, but with a parent from the start:
  // the frames inherit the draft's scope and are deleted with it, and the
  // queue's per-frame key rides along so a re-drain cannot double a photograph.
  async storeFrame(
    intakeDraftId: string,
    imageDataUrl: string,
    clientOpId: string | null,
    locale?: string,
  ): Promise<string> {
    const imageUrl = await this.attachments.saveDataUrl(
      { pluginId: 'inventory', intakeDraftId, clientOpId },
      imageDataUrl,
    );
    if (!imageUrl) {
      throw new Error(
        this.i18n.t('inventory.errors.recognizeNoImage', undefined, locale),
      );
    }
    return imageUrl;
  }

  // Drop frames the person abandoned (#217): a frame ✕'d off the filmstrip, or
  // the whole set when they leave the collecting mode.
  //
  // Only a PARENTLESS inventory frame is deletable here — one that has not
  // become an item's photograph or a draft's. A URL naming anything else is
  // ignored rather than obeyed: this endpoint must not be a way to delete a
  // picture that belongs to a record. Visibility is the scoped Prisma client's
  // job, so somebody else's frame reads back as missing.
  async discardFrames(
    imageUrls: readonly string[],
  ): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const url of imageUrls) {
      const att = await this.attachments.findByUrl(url);
      if (!att) continue;
      const row = await this.prisma.attachment.findUnique({
        where: { id: att.id },
        select: { projectId: true, componentId: true, intakeDraftId: true },
      });
      if (
        !row ||
        row.projectId !== null ||
        row.componentId !== null ||
        row.intakeDraftId !== null
      ) {
        continue;
      }
      if (await this.attachments.deleteById(att.id)) deleted++;
    }
    return { deleted };
  }

  // Recognize ALREADY stored photographs. The conveyor calls this after the
  // phone has moved on to the next part.
  //
  // The frames are several ANGLES of one part, never several parts (#215): the
  // marking is on one face, the footprint on another, the packaging label on a
  // third. The system prompt says so, and the answer is one item assembled from
  // all of them.
  async recognizeStored(
    imageUrls: string[],
    locale?: string,
  ): Promise<RecognizedItemDraft> {
    const vision = this.capabilities.getCapability<VisionCompletionCapability>(
      VISION_COMPLETION_CAPABILITY,
    );
    if (!vision) {
      throw new Error(
        this.i18n.t('inventory.errors.recognizeUnavailable', undefined, locale),
      );
    }

    // The tree goes INTO the prompt, so the answer can only be a category that
    // exists (#206). Before this, the model named a group per photograph and the
    // same box of resistors came back as "Резисторы", "resistors" and
    // "Electronic components" on three consecutive frames.
    const catalogue = await this.categories.paths();
    const raw = await vision.runVisionCompletion(
      this.i18n.t(
        'inventory.prompt.recognizeSystem',
        { categories: this.renderCatalogue(catalogue, locale) },
        locale,
      ),
      this.i18n.t('inventory.prompt.recognizeUser', undefined, locale),
      imageUrls,
      locale,
    );
    if (raw === null) {
      throw new Error(
        this.i18n.t('inventory.errors.recognizeNoProvider', undefined, locale),
      );
    }

    const parsed = this.parse(raw);
    if (!parsed) {
      throw new Error(
        this.i18n.t('inventory.errors.recognizeParseFailed', undefined, locale),
      );
    }

    // A category outside the list is treated as none at all. The model is asked
    // to choose, not to invent, and an id it made up would either miss or — far
    // worse — hit somebody else's category.
    const categoryId =
      parsed.categoryId && catalogue.has(parsed.categoryId)
        ? parsed.categoryId
        : null;

    return {
      ...parsed,
      categoryId,
      propertyValues: await this.extractProperties(
        categoryId,
        parsed.description,
        locale,
      ),
      // The frames the answer was built from, in the order they were sent — the
      // first is the cover of the item this becomes.
      imageUrls,
      candidates: await this.findCandidates(parsed.name, parsed.sku),
    };
  }

  // The second call, and the reason the first one is asked for a DETAILED
  // description: this one is text-only. Re-sending the photograph to ask "what
  // is its resistance" would be billed for image tokens twice to learn nothing
  // the description did not already carry.
  //
  // Runs at all only when a category was resolved AND it actually declares
  // properties — otherwise there is no question to ask.
  async extractProperties(
    categoryId: string | null,
    description: string | null,
    locale?: string,
  ): Promise<Record<string, string>> {
    if (!categoryId || !description) return {};
    const properties = await this.categories.effectiveProperties(categoryId);
    if (properties.length === 0) return {};

    const text = this.capabilities.getCapability<TextCompletionCapability>(
      TEXT_COMPLETION_CAPABILITY,
    );
    // The vision half answered, so the AI plugin is there; this is the belt for
    // an instance where only one of the two capabilities is registered. The
    // draft keeps its name and category and simply carries no guessed values.
    if (!text) return {};

    let raw: string | null;
    try {
      raw = await text.runTextCompletion(
        this.i18n.t(
          'inventory.prompt.propertiesSystem',
          { properties: this.renderProperties(properties, locale) },
          locale,
        ),
        description,
        locale,
      );
    } catch (err) {
      // Property values are a bonus on top of a recognition that already
      // succeeded. Losing them must not lose the draft.
      this.logger.warn(`Property extraction failed: ${getErrorMessage(err)}`);
      return {};
    }
    if (raw === null) return {};

    const answered = this.parseValues(raw);
    if (!answered) return {};

    const byId = new Map(properties.map((property) => [property.id, property]));
    const values: Record<string, string> = {};
    for (const [propertyId, guess] of Object.entries(answered)) {
      const property = byId.get(propertyId);
      if (!property) continue;
      // The same rule the write path applies (§ coercePropertyValue): a value
      // that would be dropped on save is dropped here, so the phone never shows
      // a field it is about to lose.
      const coerced = coercePropertyValue(property, guess);
      if (coerced === undefined || coerced === null) continue;
      values[propertyId] = String(coerced);
    }
    return values;
  }

  private renderCatalogue(
    catalogue: Map<string, string>,
    locale?: string,
  ): string {
    if (catalogue.size === 0) {
      return this.i18n.t('inventory.prompt.noCategories', undefined, locale);
    }
    return [...catalogue].map(([id, path]) => `${id}: ${path}`).join('\n');
  }

  // Each property as an id, a name, a type and — where it is closed — the exact
  // spellings that are allowed, so the model picks one instead of paraphrasing.
  private renderProperties(
    properties: EffectiveProperty[],
    locale?: string,
  ): string {
    return properties
      .map((property) => {
        const parts = [`${property.id}: ${property.name}`, property.type];
        if (property.unit) parts.push(property.unit);
        if (property.type === 'select' && property.options.length) {
          parts.push(
            this.i18n.t(
              'inventory.prompt.propertyOptions',
              { options: property.options.join(' | ') },
              locale,
            ),
          );
        }
        return parts.join(' · ');
      })
      .join('\n');
  }

  // Tolerant parse: models wrap JSON in fences and prose no matter how firmly
  // the prompt asks them not to.
  private parse(
    raw: string,
  ): Omit<
    RecognizedItemDraft,
    'imageUrls' | 'candidates' | 'propertyValues'
  > | null {
    const json = this.parseObject(raw);
    if (!json) return null;

    const name = asOptionalString(json.name);
    // A draft with no name has nothing to prefill — better to say "not
    // recognized" than to hand back an empty form pretending it worked.
    if (name === null) return null;

    return {
      name,
      sku: asOptionalString(json.sku),
      categoryId: asOptionalString(json.categoryId),
      description: asOptionalString(json.description),
      unit: asOptionalString(json.unit),
    };
  }

  // The second call's answer: a flat `{propertyId: value}` map. Values arrive as
  // strings or numbers depending on the model's mood; anything structured is
  // not an answer to "what is the resistance" and is dropped.
  private parseValues(raw: string): Record<string, string | number> | null {
    const json = this.parseObject(raw);
    if (!json) return null;
    const values: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === 'string' || typeof value === 'number') {
        values[key] = value;
      }
    }
    return values;
  }

  private parseObject(raw: string): Record<string, unknown> | null {
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
      this.logger.warn(`Recognition parse failed: ${getErrorMessage(err)}`);
      return null;
    }
    return isRecord(json) ? json : null;
  }

  // Existing components this might already be. An exact SKU match ranks first
  // and alone — it is a fact, not a guess; name similarity follows.
  private async findCandidates(
    name: string,
    sku: string | null,
  ): Promise<IntakeCandidate[]> {
    const components = await this.prisma.component.findMany({
      select: { id: true, name: true, sku: true, quantity: true },
    });

    if (sku) {
      const wanted = normalize(sku);
      const exact = components.filter(
        (c) => c.sku !== null && normalize(c.sku) === wanted,
      );
      if (exact.length > 0) return exact.slice(0, MAX_CANDIDATES);
    }

    const wantedName = normalize(name);
    if (wantedName === '') return [];
    return components
      .filter((c) => {
        const candidate = normalize(c.name);
        return (
          candidate === wantedName ||
          candidate.includes(wantedName) ||
          wantedName.includes(candidate)
        );
      })
      .slice(0, MAX_CANDIDATES);
  }
}
