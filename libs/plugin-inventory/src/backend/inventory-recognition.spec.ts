import { InventoryRecognitionService } from './inventory-recognition.service';
import type { InventoryCategoriesService } from './categories.service';
import type {
  AttachmentStorageService,
  CapabilityRegistryService,
  PluginI18nService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  TEXT_COMPLETION_CAPABILITY,
  VISION_COMPLETION_CAPABILITY,
} from '@makekeeper/plugin-contract';
import type { EffectiveProperty, ItemCategoryDto } from '../categories';

// Photo → prefilled form (#200), then description → property values (#206).
// What is worth pinning: the model's output is treated as untrusted text
// (fences, prose, missing fields), it may only CHOOSE a category rather than
// name one, the values it guesses are held to the same rules a save applies,
// and the whole feature disappears rather than half-works when the AI Assistant
// plugin is not there.

interface ComponentRow {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
}

const property = (
  over: Partial<EffectiveProperty> & { id: string; name: string },
): EffectiveProperty => ({
  categoryId: 'cat-r',
  type: 'text',
  unit: null,
  required: false,
  options: [],
  order: 0,
  inherited: false,
  ownerCategoryName: 'Resistors',
  ...over,
});

const CATEGORIES: ItemCategoryDto[] = [
  {
    id: 'cat-p',
    name: 'Passive',
    parentId: null,
    inheritProperties: true,
    order: 0,
    properties: [],
  },
  {
    id: 'cat-r',
    name: 'Resistors',
    parentId: 'cat-p',
    inheritProperties: true,
    order: 0,
    properties: [],
  },
];

const build = (options: {
  vision: string | null;
  text?: string | null;
  components?: ComponentRow[];
  categories?: ItemCategoryDto[];
  properties?: EffectiveProperty[];
  // An instance where chat registered vision but not its text sibling.
  noTextCapability?: boolean;
  // Observes what the vision capability was actually handed (#215).
  onVision?: (imageUrls: string[]) => void;
}) => {
  const prisma = {
    component: { findMany: () => Promise.resolve(options.components ?? []) },
  } as unknown as PrismaService;

  const i18n = {
    // The service only ever passes keys through; echoing them keeps the
    // assertions about behaviour rather than about wording.
    t: (key: string) => key,
  } as unknown as PluginI18nService;

  const attachments = {
    saveDataUrl: () => Promise.resolve('/api/uploads/photo-1'),
  } as unknown as AttachmentStorageService;

  const textCalls: string[] = [];
  const capabilities = {
    getCapability: (name: string) => {
      if (name === VISION_COMPLETION_CAPABILITY) {
        return options.vision === null
          ? null
          : {
              runVisionCompletion: (
                _system: string,
                _user: string,
                imageUrls: string[],
              ) => {
                options.onVision?.(imageUrls);
                return Promise.resolve(options.vision);
              },
            };
      }
      if (name === TEXT_COMPLETION_CAPABILITY) {
        if (options.noTextCapability) return null;
        return {
          runTextCompletion: (_system: string, user: string) => {
            textCalls.push(user);
            return Promise.resolve(options.text ?? null);
          },
        };
      }
      return null;
    },
  } as unknown as CapabilityRegistryService;

  // The tree walk belongs to the categories service, so the double answers with
  // paths the way that service does — the recognition service only renders them.
  const categories = {
    paths: () => {
      const all = options.categories ?? CATEGORIES;
      const byId = new Map(all.map((entry) => [entry.id, entry]));
      return Promise.resolve(
        new Map(
          all.map((entry) => {
            const segments: string[] = [];
            let current: ItemCategoryDto | undefined = entry;
            while (current) {
              segments.unshift(current.name);
              current = current.parentId
                ? byId.get(current.parentId)
                : undefined;
            }
            return [entry.id, segments.join(' / ')] as const;
          }),
        ),
      );
    },
    effectiveProperties: () => Promise.resolve(options.properties ?? []),
  } as unknown as InventoryCategoriesService;

  return {
    service: new InventoryRecognitionService(
      prisma,
      i18n,
      attachments,
      capabilities,
      categories,
    ),
    textCalls,
  };
};

describe('InventoryRecognitionService', () => {
  it('reads a fenced JSON reply and keeps the stored photo', async () => {
    const { service } = build({
      vision:
        'Sure!\n```json\n{"name":"Resistor 10k 0805","sku":"RC0805","categoryId":"cat-r","description":"Black 0805 chip marked 103","unit":"pcs"}\n```',
    });

    const draft = await service.recognizeStored(['/api/uploads/photo-1']);

    expect(draft).toMatchObject({
      name: 'Resistor 10k 0805',
      sku: 'RC0805',
      categoryId: 'cat-r',
      description: 'Black 0805 chip marked 103',
      unit: 'pcs',
      imageUrls: ['/api/uploads/photo-1'],
    });
  });

  // One frame must behave exactly as it did before the capability learned to
  // take a set (#215) — this is the regression the change is measured against.
  it('sends a single frame as a one-element set', async () => {
    const sent: unknown[] = [];
    const { service } = build({
      vision: '{"name":"Bracket"}',
      onVision: (imageUrls) => sent.push(imageUrls),
    });

    await service.recognizeStored(['/api/uploads/photo-1']);

    expect(sent).toEqual([['/api/uploads/photo-1']]);
  });

  // Several angles of ONE part produce ONE draft — the whole point of the epic.
  it('sends every stored frame and returns one item', async () => {
    const sent: unknown[] = [];
    const { service } = build({
      vision: '{"name":"Resistor 10k 0805"}',
      onVision: (imageUrls) => sent.push(imageUrls),
    });

    const draft = await service.recognizeStored([
      '/api/uploads/att_a',
      '/api/uploads/att_b',
      '/api/uploads/att_c',
    ]);

    expect(sent).toEqual([
      ['/api/uploads/att_a', '/api/uploads/att_b', '/api/uploads/att_c'],
    ]);
    expect(draft.name).toBe('Resistor 10k 0805');
    expect(draft.imageUrls).toHaveLength(3);
  });

  it('turns absent fields into null rather than empty strings', async () => {
    const { service } = build({
      vision: '{"name":"Unmarked bracket","sku":"","categoryId":null}',
    });

    const draft = await service.recognizeStored(['/api/uploads/photo-1']);

    expect(draft.sku).toBeNull();
    expect(draft.categoryId).toBeNull();
    expect(draft.description).toBeNull();
    expect(draft.unit).toBeNull();
  });

  it('rejects a reply with no name instead of handing back an empty form', async () => {
    const { service } = build({ vision: '{"sku":"RC0805"}' });
    await expect(
      service.recognizeStored(['/api/uploads/photo-1']),
    ).rejects.toThrow('inventory.errors.recognizeParseFailed');
  });

  it('rejects unparseable prose', async () => {
    const { service } = build({ vision: 'I cannot tell what this is.' });
    await expect(
      service.recognizeStored(['/api/uploads/photo-1']),
    ).rejects.toThrow('inventory.errors.recognizeParseFailed');
  });

  it('offers the exact SKU match alone, ahead of name lookalikes', async () => {
    const { service } = build({
      vision: '{"name":"Resistor 10k","sku":"rc-0805"}',
      components: [
        { id: 'c1', name: 'Resistor 10k 0805', sku: 'RC0805', quantity: 40 },
        { id: 'c2', name: 'Resistor 10k 0603', sku: 'RC0603', quantity: 12 },
      ],
    });

    const draft = await service.recognizeStored(['/api/uploads/photo-1']);

    // Punctuation differs, the part does not.
    expect(draft.candidates.map((c) => c.id)).toEqual(['c1']);
  });

  it('falls back to name similarity when no SKU matches', async () => {
    const { service } = build({
      vision: '{"name":"Resistor 10k","sku":"nothing-like-it"}',
      components: [
        { id: 'c1', name: 'Resistor 10k 0805', sku: 'RC0805', quantity: 40 },
        { id: 'c2', name: 'Capacitor 100n', sku: 'CC100', quantity: 5 },
      ],
    });

    const draft = await service.recognizeStored(['/api/uploads/photo-1']);

    expect(draft.candidates.map((c) => c.id)).toEqual(['c1']);
  });

  it('reports itself unavailable and refuses to run without the AI Assistant', async () => {
    const { service } = build({ vision: null });
    expect(service.isAvailable()).toBe(false);
    await expect(
      service.recognizeStored(['/api/uploads/photo-1']),
    ).rejects.toThrow('inventory.errors.recognizeUnavailable');
  });
});

// The category is CHOSEN, never invented (#206). Before this, the same box came
// back as "Резисторы", "resistors" and "Electronic components" on three
// consecutive frames, because the model was asked to name a group.
describe('choosing a category', () => {
  it('keeps an id that is in the tree', async () => {
    const { service } = build({
      vision: '{"name":"R 10k","categoryId":"cat-r"}',
    });
    expect(
      (await service.recognizeStored(['/api/uploads/photo-1'])).categoryId,
    ).toBe('cat-r');
  });

  it('discards an id that is not', async () => {
    // The dangerous shape: a plausible-looking id the model made up. It could
    // otherwise land the item in somebody else's category.
    const { service } = build({
      vision: '{"name":"R 10k","categoryId":"cat-invented"}',
    });
    expect(
      (await service.recognizeStored(['/api/uploads/photo-1'])).categoryId,
    ).toBeNull();
  });

  it('discards a category NAME answered where an id was asked for', async () => {
    const { service } = build({
      vision: '{"name":"R 10k","categoryId":"Resistors"}',
    });
    expect(
      (await service.recognizeStored(['/api/uploads/photo-1'])).categoryId,
    ).toBeNull();
  });
});

describe('extracting property values', () => {
  const PROPERTIES = [
    property({ id: 'p-res', name: 'Resistance', unit: 'Ohm', type: 'number' }),
    property({
      id: 'p-pkg',
      name: 'Package',
      type: 'select',
      options: ['0805', '0603'],
    }),
    property({ id: 'p-note', name: 'Note' }),
  ];

  const recognize = async (text: string | null, over = {}) => {
    const { service, textCalls } = build({
      vision:
        '{"name":"R 10k","categoryId":"cat-r","description":"0805 chip marked 103"}',
      text,
      properties: PROPERTIES,
      ...over,
    });
    const draft = await service.recognizeStored(['/api/uploads/photo-1']);
    return { draft, textCalls };
  };

  it('asks the text model about the DESCRIPTION, not the picture', async () => {
    const { draft, textCalls } = await recognize(
      '{"p-res":10000,"p-pkg":"0805"}',
    );
    expect(textCalls).toEqual(['0805 chip marked 103']);
    expect(draft.propertyValues).toEqual({ 'p-res': '10000', 'p-pkg': '0805' });
  });

  it('drops a value that does not fit its property', async () => {
    const { draft } = await recognize(
      // A number that is not one, a select option outside the list, and an id
      // belonging to no property of this category.
      '{"p-res":"about ten kilo","p-pkg":"SOT-23","p-ghost":"x"}',
    );
    expect(draft.propertyValues).toEqual({});
  });

  it('matches a select option written in a different case', async () => {
    const { service } = build({
      vision: '{"name":"R","categoryId":"cat-r","description":"d"}',
      text: '{"p-pkg":"0805 "}',
      properties: PROPERTIES,
    });
    const draft = await service.recognizeStored(['/api/uploads/photo-1']);
    expect(draft.propertyValues).toEqual({ 'p-pkg': '0805' });
  });

  it('does not call the text model when the category has no properties', async () => {
    const { draft, textCalls } = await recognize('{"p-res":1}', {
      properties: [],
    });
    expect(textCalls).toEqual([]);
    expect(draft.propertyValues).toEqual({});
  });

  it('does not call it when no category was resolved', async () => {
    const { service, textCalls } = build({
      vision: '{"name":"R 10k","categoryId":null,"description":"d"}',
      text: '{"p-res":1}',
      properties: PROPERTIES,
    });
    const draft = await service.recognizeStored(['/api/uploads/photo-1']);
    expect(textCalls).toEqual([]);
    expect(draft.propertyValues).toEqual({});
  });

  it('still returns the draft when the second call answers nothing', async () => {
    // The values are a bonus on top of a recognition that already worked.
    // Losing them must not lose the name, the category or the photo.
    const { draft } = await recognize(null);
    expect(draft.name).toBe('R 10k');
    expect(draft.categoryId).toBe('cat-r');
    expect(draft.propertyValues).toEqual({});
  });

  it('still returns the draft when only the vision capability exists', async () => {
    const { draft } = await recognize('{"p-res":1}', {
      noTextCapability: true,
    });
    expect(draft.name).toBe('R 10k');
    expect(draft.propertyValues).toEqual({});
  });
});

// Frames a person dropped or abandoned (#217). The endpoint deletes them, and
// deletes nothing else: it must never become a way to remove a picture that
// belongs to a record.
describe('InventoryRecognitionService.discardFrames', () => {
  const build = (
    rows: {
      id: string;
      projectId: string | null;
      componentId: string | null;
      intakeDraftId: string | null;
    }[],
  ) => {
    const deleted: string[] = [];
    const prisma = {
      attachment: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.find((row) => row.id === where.id) ?? null),
      },
    } as unknown as PrismaService;
    const attachments = {
      findByUrl: (url: string) => {
        const id = url.split('/').pop() ?? '';
        return Promise.resolve(
          rows.some((row) => row.id === id) ? { id } : null,
        );
      },
      deleteById: (id: string) => {
        deleted.push(id);
        return Promise.resolve(true);
      },
    } as unknown as AttachmentStorageService;
    return {
      service: new InventoryRecognitionService(
        prisma,
        { t: (key: string) => key } as unknown as PluginI18nService,
        attachments,
        { getCapability: () => null } as unknown as CapabilityRegistryService,
        {} as unknown as InventoryCategoriesService,
      ),
      deleted,
    };
  };

  const loose = (id: string) => ({
    id,
    projectId: null,
    componentId: null,
    intakeDraftId: null,
  });

  it('deletes a parentless frame', async () => {
    const { service, deleted } = build([loose('att_1'), loose('att_2')]);
    expect(
      await service.discardFrames(['/api/uploads/att_1', '/api/uploads/att_2']),
    ).toEqual({ deleted: 2 });
    expect(deleted).toEqual(['att_1', 'att_2']);
  });

  it('refuses a picture that belongs to an item', async () => {
    const { service, deleted } = build([
      { ...loose('att_1'), componentId: 'comp_1' },
    ]);
    expect(await service.discardFrames(['/api/uploads/att_1'])).toEqual({
      deleted: 0,
    });
    expect(deleted).toEqual([]);
  });

  it('refuses a frame that belongs to a draft', async () => {
    const { service, deleted } = build([
      { ...loose('att_1'), intakeDraftId: 'draft_1' },
    ]);
    expect(await service.discardFrames(['/api/uploads/att_1'])).toEqual({
      deleted: 0,
    });
    expect(deleted).toEqual([]);
  });

  it('ignores a URL that names nothing', async () => {
    const { service, deleted } = build([]);
    expect(await service.discardFrames(['/api/uploads/att_gone'])).toEqual({
      deleted: 0,
    });
    expect(deleted).toEqual([]);
  });
});
