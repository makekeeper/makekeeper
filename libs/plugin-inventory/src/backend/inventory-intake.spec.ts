import { InventoryIntakeService } from './inventory-intake.service';
import type { InventoryRecognitionService } from './inventory-recognition.service';
import type { InventoryCategoriesService } from './categories.service';
import type { InventoryService } from './inventory.service';
import type { EffectiveProperty } from '../categories';
import type {
  AttachmentStorageService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';

// The conveyor (#201). The properties that matter are the ones a person leaning
// over a shelf would notice: capture returns without waiting for the model, a
// failed recognition still leaves something a human can finish, and committing
// either creates a card or adds to an existing one — never both, never neither.

interface DraftRow {
  id: string;
  scopeId: string | null;
  clientOpId: string | null;
  clientDraftId: string | null;
  status: string;
  name: string | null;
  sku: string | null;
  categoryId: string | null;
  description: string | null;
  propertyValues: string | null;
  unit: string | null;
  quantity: number;
  storageId: string | null;
  storageRow: number | null;
  storageCol: number | null;
  errorKey: string | null;
  createdAt: Date;
}

const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

function harness(options: {
  // Categories that exist right now — a category deleted while the batch waited
  // is simply absent from this list.
  categoryIds?: string[];
  recognizeResult?: () => Promise<{
    name: string;
    sku: string | null;
    categoryId: string | null;
    description: string | null;
    propertyValues: Record<string, string>;
    unit: string | null;
  }>;
  available?: boolean;
  // A component already carrying this SKU, so the commit finds it.
  existingSku?: string;
  // What the chosen category declares, so an edited value can be held to it.
  properties?: EffectiveProperty[];
  // Pictures the commit target already has, so the attach-or-drop rule (#216)
  // can be exercised both ways.
  targetPhotos?: string[];
  // Observes the frame set handed to the model.
  onRecognize?: (imageUrls: string[]) => void;
}) {
  const rows: DraftRow[] = [];
  // A draft's frames are Attachment rows keyed by `intakeDraftId` (#216).
  const frames: {
    id: string;
    intakeDraftId: string | null;
    clientOpId: string | null;
  }[] = [];
  let frameSeq = 0;
  const framesSetOnComponent: {
    componentId: string;
    urls: readonly string[];
  }[] = [];
  const deletedFrames: string[] = [];
  const created: {
    name: string;
    quantity?: number;
    categoryId?: string | null;
    description?: string;
    propertyValues?: Record<string, string | number | null>;
    photos?: string[];
  }[] = [];
  const adjusted: { id: string; amount: number }[] = [];

  const prisma = {
    itemCategory: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          (options.categoryIds ?? []).includes(where.id)
            ? { id: where.id }
            : null,
        ),
    },
    inventoryIntakeDraft: {
      create: ({ data }: { data: Partial<DraftRow> }) => {
        const defaults: Omit<DraftRow, 'id' | 'status' | 'quantity'> = {
          scopeId: null,
          clientOpId: null,
          clientDraftId: null,
          name: null,
          sku: null,
          categoryId: null,
          description: null,
          propertyValues: null,
          unit: null,
          storageId: null,
          storageRow: null,
          storageCol: null,
          errorKey: null,
          createdAt: new Date('2026-07-31T12:00:00Z'),
        };
        const row: DraftRow = { ...defaults, ...(data as DraftRow) };
        rows.push(row);
        return Promise.resolve(row);
      },
      findUnique: ({
        where,
      }: {
        where: { id?: string; clientOpId?: string; clientDraftId?: string };
      }) =>
        Promise.resolve(
          rows.find(
            (r) =>
              (where.id !== undefined && r.id === where.id) ||
              (where.clientOpId !== undefined &&
                r.clientOpId === where.clientOpId) ||
              (where.clientDraftId !== undefined &&
                r.clientDraftId === where.clientDraftId),
          ) ?? null,
        ),
      findMany: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
        Promise.resolve(
          where?.id
            ? rows.filter((r) => where.id!.in.includes(r.id))
            : [...rows],
        ),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<DraftRow>;
      }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i >= 0) rows.splice(i, 1);
        return Promise.resolve({});
      },
      deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
        const before = rows.length;
        for (const id of where.id.in) {
          const i = rows.findIndex((r) => r.id === id);
          if (i >= 0) rows.splice(i, 1);
        }
        return Promise.resolve({ count: before - rows.length });
      },
    },
    attachment: {
      findMany: ({
        where,
      }: {
        where: { intakeDraftId?: string | { in: string[] } };
      }) => {
        const wanted = where.intakeDraftId;
        const ids =
          typeof wanted === 'string'
            ? [wanted]
            : Array.isArray(wanted?.in)
              ? wanted.in
              : [];
        return Promise.resolve(
          frames
            .filter(
              (f) => f.intakeDraftId !== null && ids.includes(f.intakeDraftId),
            )
            .map((f) => ({
              id: f.id,
              intakeDraftId: f.intakeDraftId,
              // Carried because a frame can be named by the operation that
              // uploaded it — the only address a phone has for a photograph it
              // queued offline.
              clientOpId: f.clientOpId,
            })),
        );
      },
      findUnique: ({ where }: { where: { clientOpId?: string } }) =>
        Promise.resolve(
          frames.find(
            (f) =>
              where.clientOpId !== undefined &&
              f.clientOpId === where.clientOpId,
          ) ?? null,
        ),
      count: ({
        where,
      }: {
        where: { intakeDraftId?: string; componentId?: string };
      }) =>
        Promise.resolve(
          where.componentId !== undefined
            ? (options.targetPhotos ?? []).length
            : frames.filter((f) => f.intakeDraftId === where.intakeDraftId)
                .length,
        ),
    },
  } as unknown as PrismaService;

  const attachments = {
    // The real one lives in backend-core and is covered there; this double
    // answers the same question over the fake rows.
    photosByOwner: (owners: { id: string }[]) =>
      Promise.resolve(
        new Map(
          owners.map((owner) => [
            owner.id,
            frames
              .filter((f) => f.intakeDraftId === owner.id)
              .map((f) => ({
                id: f.id,
                url: `/api/uploads/${f.id}`,
                isCover: false,
              })),
          ]),
        ),
      ),
    deleteById: (id: string) => {
      deletedFrames.push(id);
      const i = frames.findIndex((f) => f.id === id);
      if (i >= 0) frames.splice(i, 1);
      return Promise.resolve(true);
    },
  } as unknown as AttachmentStorageService;

  const i18n = { t: (key: string) => key } as unknown as PluginI18nService;
  const requestContext = {
    get: () => ({ scopeId: 'scope-1' }),
  } as unknown as RequestContextService;

  const inventory = {
    findBySku: (sku: string) =>
      Promise.resolve(
        options.existingSku && sku === options.existingSku
          ? [{ id: 'existing-sku', name: 'On the shelf', sku }]
          : [],
      ),
    create: (data: {
      name: string;
      quantity?: number;
      categoryId?: string | null;
      description?: string;
      propertyValues?: Record<string, string | number | null>;
      photos?: string[];
    }) => {
      created.push(data);
      return Promise.resolve({ id: `c-${created.length}`, ...data });
    },
    adjustQty: (id: string, amount: number) => {
      adjusted.push({ id, amount });
      return Promise.resolve({});
    },
    photoCount: () => Promise.resolve((options.targetPhotos ?? []).length),
    addPhotos: (componentId: string, urls: readonly string[]) => {
      framesSetOnComponent.push({ componentId, urls });
      return Promise.resolve();
    },
  } as unknown as InventoryService;

  const recognition = {
    isAvailable: () => options.available ?? true,
    storePhoto: () => Promise.resolve('/api/uploads/photo-1'),
    storeFrame: (
      intakeDraftId: string,
      _dataUrl: string,
      clientOpId: string | null,
    ) => {
      const id = `att_${++frameSeq}`;
      frames.push({ id, intakeDraftId, clientOpId });
      return Promise.resolve(`/api/uploads/${id}`);
    },
    recognizeStored: (imageUrls: string[]) => {
      options.onRecognize?.(imageUrls);
      return options.recognizeResult
        ? options.recognizeResult()
        : Promise.resolve({
            name: 'Resistor 10k',
            sku: 'RC0805',
            categoryId: null,
            description: null,
            propertyValues: {},
            unit: 'pcs',
          });
    },
  } as unknown as InventoryRecognitionService;

  const categories = {
    effectiveProperties: () => Promise.resolve(options.properties ?? []),
  } as unknown as InventoryCategoriesService;

  return {
    service: new InventoryIntakeService(
      prisma,
      i18n,
      requestContext,
      inventory,
      recognition,
      categories,
      attachments,
    ),
    rows,
    created,
    adjusted,
    frames,
    framesSetOnComponent,
    deletedFrames,
  };
}

describe('InventoryIntakeService', () => {
  it('returns a draft immediately, and asks no model to look at it', async () => {
    const { service, rows } = harness({});

    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
      quantity: 5,
    });

    // The camera is free to move on the moment this resolves — and nothing has
    // been spent on a part the person may well be able to name at a glance.
    expect(draft.status).toBe('ready');
    expect(draft.quantity).toBe(5);
    expect(draft.name).toBeNull();

    await settle();
    expect(rows[0].name).toBeNull();
  });

  it('recognizes one draft when asked, and answers with the result', async () => {
    const { service } = harness({});
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });

    const recognized = await service.recognize(draft.id);

    // Synchronous on purpose: the person pressed a button and is watching the
    // row, so the answer belongs in the response.
    expect(recognized).toMatchObject({ status: 'ready', name: 'Resistor 10k' });
  });

  it('marks a draft failed rather than losing the shot', async () => {
    const { service, rows } = harness({
      recognizeResult: () => Promise.reject(new Error('no provider')),
    });

    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });
    const failed = await service.recognize(draft.id);

    expect(failed.status).toBe('failed');
    // The frames survive, so a human can still say what it is.
    expect(failed.imageUrls).toEqual(['/api/uploads/att_1']);
    expect(failed.errorKey).toBe('inventory.errors.recognizeParseFailed');
  });

  it('refuses to recognize a draft with no photo', async () => {
    const { service } = harness({});
    const draft = await service.capture({ quantity: 1 });
    await expect(service.recognize(draft.id)).rejects.toThrow(
      'inventory.errors.recognizeNoImage',
    );
  });

  it('stamps the acting scope onto the draft', async () => {
    const { service, rows } = harness({});
    await service.capture({ quantity: 2 });
    expect(rows[0].scopeId).toBe('scope-1');
  });

  it('commits a new component and consumes the draft', async () => {
    const { service, rows, created } = harness({});
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
      quantity: 3,
    });
    await service.recognize(draft.id);

    const result = await service.commit(draft.id);

    expect(result).toMatchObject({ created: true, quantity: 3 });
    expect(created[0]).toMatchObject({ name: 'Resistor 10k', quantity: 3 });
    expect(rows).toHaveLength(0);
  });

  it('commits into an existing component as a receipt, not a second card', async () => {
    const { service, created, adjusted } = harness({});
    const draft = await service.capture({ quantity: 7 });

    const result = await service.commit(draft.id, 'existing-1');

    expect(result).toMatchObject({ created: false, componentId: 'existing-1' });
    expect(adjusted).toEqual([{ id: 'existing-1', amount: 7 }]);
    expect(created).toHaveLength(0);
  });

  it('commits an exact SKU match as a receipt, without being told to', async () => {
    const { service, created, adjusted } = harness({ existingSku: 'RC0805' });
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
      quantity: 4,
    });
    await service.recognize(draft.id);

    const result = await service.commit(draft.id);

    // The part is already on the shelf: adding a second card for it is the
    // duplicate the whole scan-first design exists to avoid.
    expect(result).toMatchObject({
      created: false,
      componentId: 'existing-sku',
    });
    expect(adjusted).toEqual([{ id: 'existing-sku', amount: 4 }]);
    expect(created).toHaveLength(0);
  });

  it('refuses to commit a nameless draft', async () => {
    const { service } = harness({ available: false });
    const draft = await service.capture({});
    await expect(service.commit(draft.id)).rejects.toThrow(
      'inventory.errors.draftNeedsName',
    );
  });

  it('a human edit names a draft no model ever looked at', async () => {
    const { service, rows } = harness({});
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });

    const updated = await service.update(draft.id, { name: 'Typed by hand' });

    expect(updated.status).toBe('ready');
    expect(rows[0].name).toBe('Typed by hand');
  });

  it('discards only what it was asked to discard', async () => {
    const { service, rows } = harness({ available: false });
    const first = await service.capture({});
    await service.capture({});

    expect(await service.discard([first.id])).toEqual({ deleted: 1 });
    expect(rows).toHaveLength(1);
  });
});

// A shot is no longer an item (#216). Frames glue into one draft by a key the
// PHONE mints, because a queued frame cannot learn a server id.
describe('several frames per draft', () => {
  const shoot = (n: number) => ({
    imageDataUrl: `data:image/jpeg;base64,AAA${n}`,
    clientDraftId: 'draft-key-1',
    clientOpId: `op-${n}`,
  });

  it('collects three frames shot offline into ONE draft', async () => {
    const { service, rows } = harness({});

    await service.capture(shoot(1));
    await service.capture(shoot(2));
    const third = await service.capture(shoot(3));

    expect(rows).toHaveLength(1);
    expect(third.imageUrls).toEqual([
      '/api/uploads/att_1',
      '/api/uploads/att_2',
      '/api/uploads/att_3',
    ]);
  });

  // Draining the same queue twice is the NORMAL outcome of a request that timed
  // out; it must produce neither a second draft nor duplicate frames.
  it('is idempotent when the queue is drained twice', async () => {
    const { service, rows, frames } = harness({});

    await service.capture(shoot(1));
    await service.capture(shoot(2));
    await service.capture(shoot(1));
    await service.capture(shoot(2));

    expect(rows).toHaveLength(1);
    expect(frames).toHaveLength(2);
  });

  // Dropping ONE bad angle off a draft that already exists (#212 UI pass). The
  // properties that matter are that the frame is named rather than counted, and
  // that the draft outlives its last photograph.
  it('drops the frame named by the operation that uploaded it', async () => {
    const { service, frames } = harness({});
    await service.capture(shoot(1));
    await service.capture(shoot(2));

    const left = await service.discardFramesOf('draft-key-1', {
      imageUrls: [],
      clientOpIds: ['op-1'],
    });

    expect(frames.map((f) => f.clientOpId)).toEqual(['op-2']);
    expect(left.imageUrls).toEqual(['/api/uploads/att_2']);
  });

  it('drops the frame named by its url', async () => {
    const { service, frames } = harness({});
    await service.capture(shoot(1));
    await service.capture(shoot(2));

    await service.discardFramesOf('draft-key-1', {
      imageUrls: ['/api/uploads/att_2'],
      clientOpIds: [],
    });

    expect(frames.map((f) => f.id)).toEqual(['att_1']);
  });

  // A drop drained twice must delete once — which is what naming a frame buys
  // over counting to it: the second pass finds nothing by that name.
  it('is idempotent when the same drop is replayed', async () => {
    const { service, frames } = harness({});
    await service.capture(shoot(1));
    await service.capture(shoot(2));
    const drop = { imageUrls: [], clientOpIds: ['op-1'] };

    await service.discardFramesOf('draft-key-1', drop);
    await service.discardFramesOf('draft-key-1', drop);

    expect(frames.map((f) => f.clientOpId)).toEqual(['op-2']);
  });

  // The draft is a scratchpad somebody may have typed a name into; losing that
  // to a dropped photograph would be the worse trade.
  it('keeps the draft when its last frame goes', async () => {
    const { service, rows } = harness({});
    await service.capture(shoot(1));

    const left = await service.discardFramesOf('draft-key-1', {
      imageUrls: [],
      clientOpIds: ['op-1'],
    });

    expect(rows).toHaveLength(1);
    expect(left.imageUrls).toEqual([]);
  });

  it('gives frames without a draft key one draft each — the old behaviour', async () => {
    const { service, rows } = harness({});

    await service.capture({ imageDataUrl: 'data:image/jpeg;base64,A' });
    await service.capture({ imageDataUrl: 'data:image/jpeg;base64,B' });

    expect(rows).toHaveLength(2);
  });

  // REFUSED at the cap, not silently dropped. Answering 200 while storing
  // nothing told the phone a frame had landed that had not — the strip painted
  // it and the queue forgot the op, so the picture was gone with nobody the
  // wiser. A 4xx is what the offline queue is built to surface.
  it('refuses a frame over the cap instead of dropping it', async () => {
    const { service, frames } = harness({});

    for (let n = 1; n <= 5; n++) await service.capture(shoot(n));

    await expect(service.capture(shoot(6))).rejects.toThrow(
      'inventory.errors.draftFramesFull',
    );
    expect(frames).toHaveLength(5);
  });

  // The refusal must not catch a REPLAY: an already-known `clientOpId` answers
  // with the draft its frame landed in, so re-draining an accepted frame stays
  // idempotent rather than being rejected as the sixth.
  it('still replays an accepted frame once the draft is full', async () => {
    const { service, frames } = harness({});

    for (let n = 1; n <= 5; n++) await service.capture(shoot(n));
    const replayed = await service.capture(shoot(3));

    expect(frames).toHaveLength(5);
    expect(replayed.imageUrls).toHaveLength(5);
  });

  // Quantity and storage belong to the ITEM being shot, and the phone keeps
  // them on screen while it is shot. Moving to the next shelf and then taking a
  // second angle used to leave the new cell on the phone and the old one in the
  // draft, with nothing on either end saying so — the later frame is the
  // person's latest word, so it wins.
  it('carries quantity and storage from a later frame onto the draft', async () => {
    const { service, rows } = harness({});

    await service.capture({ ...shoot(1), quantity: 1, storageId: 'st_a' });
    await service.capture({
      ...shoot(2),
      quantity: 4,
      storageId: 'st_b',
      storageRow: 2,
      storageCol: 3,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: 4,
      storageId: 'st_b',
      storageRow: 2,
      storageCol: 3,
    });
  });

  // A field the frame does not carry leaves the draft's value alone rather than
  // resetting it — the phone sends storage only once a shelf is chosen.
  it('leaves a field a later frame does not carry alone', async () => {
    const { service, rows } = harness({});

    await service.capture({ ...shoot(1), quantity: 2, storageId: 'st_a' });
    await service.capture(shoot(2));

    expect(rows[0]).toMatchObject({ quantity: 2, storageId: 'st_a' });
  });

  it('sends every frame to the model and fills the draft from one answer', async () => {
    const sent: string[][] = [];
    const { service } = harness({
      recognizeResult: () =>
        Promise.resolve({
          name: 'Resistor 10k',
          sku: null,
          categoryId: null,
          description: null,
          propertyValues: {},
          unit: 'pcs',
        }),
      onRecognize: (urls) => sent.push(urls),
    });

    await service.capture(shoot(1));
    await service.capture(shoot(2));
    const draft = await service.capture(shoot(3));

    const recognized = await service.recognize(draft.id);

    expect(sent).toEqual([
      ['/api/uploads/att_1', '/api/uploads/att_2', '/api/uploads/att_3'],
    ]);
    expect(recognized.name).toBe('Resistor 10k');
  });

  it('carries every frame into a new item, first one the cover', async () => {
    const { service, created } = harness({});

    await service.capture(shoot(1));
    const draft = await service.capture(shoot(2));
    await service.update(draft.id, { name: 'Bracket' });

    await service.commit(draft.id);

    expect(created[0].photos).toEqual([
      '/api/uploads/att_1',
      '/api/uploads/att_2',
    ]);
  });

  // A shelf photograph of a part already pictured adds nothing and costs disk.
  it('drops the frames when the commit target already has a photograph', async () => {
    const { service, framesSetOnComponent, deletedFrames } = harness({
      targetPhotos: ['/api/uploads/att_existing'],
    });
    const draft = await service.capture(shoot(1));

    await service.commit(draft.id, 'existing-1');

    expect(framesSetOnComponent).toHaveLength(0);
    expect(deletedFrames).toEqual(['att_1']);
  });

  it('attaches them when the target has none', async () => {
    const { service, framesSetOnComponent } = harness({ targetPhotos: [] });
    const draft = await service.capture(shoot(1));

    await service.commit(draft.id, 'existing-1');

    expect(framesSetOnComponent).toEqual([
      { componentId: 'existing-1', urls: ['/api/uploads/att_1'] },
    ]);
  });

  // A person pressed Discard — a decision, not background retention (#120).
  it('deletes the photographs of a discarded draft', async () => {
    const { service, deletedFrames } = harness({});
    await service.capture(shoot(1));
    const draft = await service.capture(shoot(2));

    await service.discard([draft.id]);

    expect(deletedFrames).toEqual(['att_1', 'att_2']);
  });
});

// The category the model chose, and the values it read out of its own
// description, riding to the item (#206).
describe('committing a categorised draft', () => {
  // The one property "cat-r" declares, for the paths that hold an edited value
  // to the category's own rules.
  const PACKAGE: EffectiveProperty = {
    id: 'p-pkg',
    categoryId: 'cat-r',
    name: 'Package',
    type: 'select',
    unit: null,
    required: false,
    options: ['0805', '0603'],
    order: 0,
    inherited: false,
    ownerCategoryName: 'Resistors',
  };

  const recognized = (over = {}) => ({
    name: 'Resistor 10k',
    sku: null,
    categoryId: 'cat-r',
    description: '0805 chip marked 103',
    propertyValues: { 'p-pkg': '0805' },
    unit: 'pcs',
    ...over,
  });

  it('hands the category, description and values to create IN ONE CALL', async () => {
    const { service, created } = harness({
      categoryIds: ['cat-r'],
      recognizeResult: () => Promise.resolve(recognized()),
    });
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });
    await service.recognize(draft.id);

    await service.commit(draft.id);

    // One call matters beyond tidiness: `create` sets the values and THEN
    // announces them, and that announcement is what places the tags (#205).
    // Setting them afterwards would place none.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: 'Resistor 10k',
      categoryId: 'cat-r',
      description: '0805 chip marked 103',
      propertyValues: { 'p-pkg': '0805' },
    });
  });

  it('leaves the item uncategorised when the category is gone by commit time', async () => {
    const { service, created } = harness({
      categoryIds: [],
      recognizeResult: () => Promise.resolve(recognized()),
    });
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });
    await service.recognize(draft.id);

    await service.commit(draft.id);

    // And the values go with it: they are keyed by properties of a category
    // that no longer exists.
    expect(created[0].categoryId).toBeUndefined();
    expect(created[0].propertyValues).toBeUndefined();
  });

  it('drops the values when a human moves the draft to another category', async () => {
    const { service, rows } = harness({
      categoryIds: ['cat-r', 'cat-c'],
      recognizeResult: () => Promise.resolve(recognized()),
    });
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });
    await service.recognize(draft.id);
    expect(rows[0].propertyValues).toBe('{"p-pkg":"0805"}');

    const moved = await service.update(draft.id, { categoryId: 'cat-c' });

    // The ids belong to the old category's properties; carried along they would
    // be values for fields the next screen cannot even name.
    expect(moved.propertyValues).toEqual({});
    expect(rows[0].propertyValues).toBeNull();
  });

  it('keeps values a person typed when recognition answers with none', async () => {
    const { service, rows } = harness({
      categoryIds: ['cat-r'],
      properties: [PACKAGE],
      recognizeResult: () =>
        Promise.resolve(recognized({ propertyValues: {} })),
    });
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });
    await service.update(draft.id, {
      categoryId: 'cat-r',
      propertyValues: { 'p-pkg': '0603' },
    });

    await service.recognize(draft.id);

    // An empty answer is "I could not tell", not "clear what you typed".
    expect(rows[0].propertyValues).toBe('{"p-pkg":"0603"}');
  });

  it('drops values the new category cannot carry when recognition moves the draft', async () => {
    const { service, rows } = harness({
      categoryIds: ['cat-r', 'cat-c'],
      properties: [PACKAGE],
      recognizeResult: () =>
        Promise.resolve(
          recognized({ categoryId: 'cat-c', propertyValues: {} }),
        ),
    });
    const draft = await service.capture({
      imageDataUrl: 'data:image/jpeg;base64,AAA',
    });
    await service.update(draft.id, {
      categoryId: 'cat-r',
      propertyValues: { 'p-pkg': '0603' },
    });

    await service.recognize(draft.id);

    // "I could not tell" keeps what a person typed; landing in ANOTHER category
    // does not — those values are keyed by properties the new one has never
    // heard of, and the hand-edit path clears them for exactly this reason.
    expect(rows[0].categoryId).toBe('cat-c');
    expect(rows[0].propertyValues).toBeNull();
  });

  it('holds a value a person typed to the same rule the save applies', async () => {
    const { service, rows } = harness({
      categoryIds: ['cat-r'],
      properties: [PACKAGE],
    });
    const draft = await service.capture({});

    const updated = await service.update(draft.id, {
      categoryId: 'cat-r',
      propertyValues: {
        // Not one of the declared spellings, and an id belonging to no property
        // of this category.
        'p-pkg': 'DO-214',
        'p-ghost': 'whatever',
      },
    });

    // Dropped HERE, not silently at commit: a phone showing a value the save is
    // about to throw away is the failure the shared rule exists to prevent.
    expect(updated.propertyValues).toEqual({});
    expect(rows[0].propertyValues).toBe('{}');
  });

  it('keeps a plain-text description readable once it reaches the card', async () => {
    const { service, created } = harness({ categoryIds: [] });
    const draft = await service.capture({});
    await service.update(draft.id, {
      name: 'Header',
      description: 'pitch <5mm, marked <unreadable>',
    });

    await service.commit(draft.id);

    // The item's description is rich text run through the markup sanitizer,
    // which would have eaten "<5mm" and "<unreadable>" as tags.
    expect(created[0].description).toBe(
      'pitch &lt;5mm, marked &lt;unreadable&gt;',
    );
  });

  it('reads a draft whose stored values are corrupt as having none', async () => {
    const { service, rows } = harness({ categoryIds: ['cat-r'] });
    const draft = await service.capture({});
    rows[0].propertyValues = 'not json';
    rows[0].categoryId = 'cat-r';

    const listed = await service.list();

    // A scratchpad that cannot be opened is worse than one that lost a guess.
    expect(listed[0].propertyValues).toEqual({});
    expect(listed[0].id).toBe(draft.id);
  });
});
