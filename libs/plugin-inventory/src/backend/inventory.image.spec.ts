import { InventoryService } from './inventory.service';

// An item's photographs (#213, epic #212).
//
// The single `Component.imageUrl` column is gone: the pictures are `Attachment`
// rows keyed by `componentId`, `Component.coverAttachmentId` pins the cover, and
// `imageUrl` survives in the PAYLOAD as the derived cover URL. These tests
// exercise the write rules (adopt, drop, delete, pin) and the derived read
// against a minimal Prisma + attachment double.

interface FakeAttachment {
  id: string;
  projectId: string | null;
  componentId: string | null;
}

interface FakeComponent {
  id: string;
  quantity: number;
  coverAttachmentId: string | null;
}

const urlOf = (id: string): string => `/api/uploads/${id}`;
const idOf = (url: string): string => url.split('/').pop() ?? '';

// A store shared by the Prisma double and the attachment-service double, so a
// claim really re-parents the row the next query reads.
function makeService(seed?: {
  component?: Partial<FakeComponent>;
  attachments?: FakeAttachment[];
}): {
  service: InventoryService;
  attachmentRows: FakeAttachment[];
  component: FakeComponent;
  saved: Record<string, unknown>[];
  saveDataUrl: jest.Mock;
  claim: jest.Mock;
  deleteById: jest.Mock;
} {
  const attachmentRows: FakeAttachment[] = [...(seed?.attachments ?? [])];
  const component: FakeComponent = {
    id: 'comp_1',
    quantity: 0,
    coverAttachmentId: null,
    ...seed?.component,
  };
  const saved: Record<string, unknown>[] = [];
  let generated = 0;

  const saveDataUrl = jest.fn(() => {
    const id = `att_generated${++generated}`;
    attachmentRows.push({ id, projectId: null, componentId: null });
    return Promise.resolve(urlOf(id));
  });
  const claim = jest.fn((url: string, owner: { componentId?: string }) => {
    const row = attachmentRows.find((a) => a.id === idOf(url));
    if (row) row.componentId = owner.componentId ?? null;
    return Promise.resolve();
  });
  const findByUrl = jest.fn((url: string) => {
    const row = attachmentRows.find((a) => a.id === idOf(url));
    return Promise.resolve(row ? { id: row.id } : null);
  });
  const deleteById = jest.fn((id: string) => {
    const at = attachmentRows.findIndex((a) => a.id === id);
    if (at >= 0) attachmentRows.splice(at, 1);
    return Promise.resolve(true);
  });
  // The real one lives in backend-core and is covered there; this double applies
  // the same rule (pin if it resolves, else first) over the fake rows.
  const photosByOwner = jest.fn(
    (owners: { id: string; coverAttachmentId: string | null }[]) => {
      const out = new Map<
        string,
        { id: string; url: string; isCover: boolean }[]
      >();
      for (const owner of owners) {
        const ids = attachmentRows
          .filter((a) => a.componentId === owner.id)
          .map((a) => a.id);
        const coverId =
          owner.coverAttachmentId && ids.includes(owner.coverAttachmentId)
            ? owner.coverAttachmentId
            : ids[0];
        out.set(
          owner.id,
          ids.map((id) => ({ id, url: urlOf(id), isCover: id === coverId })),
        );
      }
      return Promise.resolve(out);
    },
  );

  const prisma = {
    component: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        saved.push(data);
        // The service mints the id, so the store adopts it — otherwise the
        // pictures claimed under it belong to an item the reads never find.
        if (typeof data.id === 'string') component.id = data.id;
        return Promise.resolve({ ...component, ...data });
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        saved.push(data);
        if ('coverAttachmentId' in data) {
          component.coverAttachmentId =
            typeof data.coverAttachmentId === 'string'
              ? data.coverAttachmentId
              : null;
        }
        return Promise.resolve({ ...component, ...data });
      }),
      findUnique: jest.fn(() => Promise.resolve({ ...component })),
      delete: jest.fn(() => Promise.resolve({ ...component })),
    },
    attachment: {
      findMany: jest.fn(
        ({ where }: { where: { componentId?: string } }) =>
          Promise.resolve(
            attachmentRows
              .filter((a) => a.componentId === where.componentId)
              .map((a) => ({ id: a.id })),
          ) as Promise<{ id: string }[]>,
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const row = attachmentRows.find((a) => a.id === where.id);
        return Promise.resolve(
          row
            ? { projectId: row.projectId, componentId: row.componentId }
            : null,
        );
      }),
    },
    stockMovement: { create: jest.fn().mockResolvedValue({}) },
    projectComponent: { findMany: jest.fn().mockResolvedValue([]) },
    taskComponent: { findMany: jest.fn().mockResolvedValue([]) },
    orderComponent: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new InventoryService(
    prisma as never,
    { t: (key: string) => key } as never,
    { getCapability: () => null } as never,
    { saveDataUrl, findByUrl, deleteById, claim, photosByOwner } as never,
    {
      itemCreated: async () => undefined,
      itemChanged: async () => undefined,
      itemDeleted: async () => undefined,
    } as never,
    {
      setValues: () => Promise.resolve(),
      valuesFor: () => Promise.resolve([]),
      effectivePropertiesFor: () => Promise.resolve([]),
      spillForCategoryChange: () => Promise.resolve(),
      filledValuesFor: () => Promise.resolve([]),
    } as never,
    { emit: async () => undefined } as never,
  );
  return {
    service,
    attachmentRows,
    component,
    saved,
    saveDataUrl,
    claim,
    deleteById,
  };
}

describe('InventoryService photo set — writes', () => {
  it('persists a data URL and pins it as the cover on create', async () => {
    const { service, saveDataUrl } = makeService();
    const created = await service.create({
      name: 'Cap',
      photos: ['data:image/jpeg;base64,AAAA'],
    });
    // Saved parentless: the component row does not exist yet, and the scope
    // policy refuses a parent it cannot find (#125).
    expect(saveDataUrl).toHaveBeenCalledWith(
      { pluginId: 'inventory', componentId: null },
      'data:image/jpeg;base64,AAAA',
    );
    expect(created.imageUrl).toBe('/api/uploads/att_generated1');
    expect(created.photos).toEqual([
      {
        id: 'att_generated1',
        url: '/api/uploads/att_generated1',
        isCover: true,
      },
    ]);
  });

  it('never writes a photo column on the component itself', async () => {
    const { service, saved } = makeService();
    await service.create({
      name: 'Cap',
      photos: ['data:image/jpeg;base64,AAAA'],
    });
    expect(saved[0]).not.toHaveProperty('imageUrl');
    expect(saved[0]).not.toHaveProperty('photos');
  });

  it('adopts the photo it just uploaded', async () => {
    const { service, claim } = makeService();
    const created = await service.create({
      name: 'Cap',
      photos: ['data:image/jpeg;base64,AAAA'],
    });
    expect(claim).toHaveBeenCalledWith('/api/uploads/att_generated1', {
      pluginId: 'inventory',
      componentId: created.id,
    });
  });

  // An intake draft's frame has no parent of its own, so it may be adopted —
  // that is how a committed draft's photograph becomes the item's.
  it('adopts a parentless stored URL the caller supplied', async () => {
    const { service, claim } = makeService({
      attachments: [{ id: 'att_draft', projectId: null, componentId: null }],
    });
    const created = await service.create({
      name: 'Cap',
      photos: ['/api/uploads/att_draft'],
    });
    expect(claim).toHaveBeenCalledWith('/api/uploads/att_draft', {
      pluginId: 'inventory',
      componentId: created.id,
    });
    expect(created.imageUrl).toBe('/api/uploads/att_draft');
  });

  // A picture belongs to ONE record. Re-filing it here would quietly move
  // somebody else's photograph under this item.
  it('drops a URL naming a picture that already belongs to something', async () => {
    const { service, claim } = makeService({
      attachments: [
        { id: 'att_theirs', projectId: 'proj_1', componentId: null },
      ],
    });
    const created = await service.create({
      name: 'Cap',
      photos: ['/api/uploads/att_theirs'],
    });
    expect(claim).not.toHaveBeenCalled();
    expect(created.photos).toEqual([]);
    expect(created.imageUrl).toBeNull();
  });

  // The LIST is always in upload order (`createdAt`) — there is no drag-to-
  // reorder. What the caller's order decides is the COVER: its first entry.
  it('pins the first entry it was given as the cover, list stays in upload order', async () => {
    const { service } = makeService({
      attachments: [
        { id: 'att_a', projectId: null, componentId: null },
        { id: 'att_b', projectId: null, componentId: null },
      ],
    });
    const created = await service.create({
      name: 'Cap',
      photos: ['/api/uploads/att_b', '/api/uploads/att_a'],
    });
    expect(created.photos.map((p) => p.id)).toEqual(['att_a', 'att_b']);
    expect(created.imageUrl).toBe('/api/uploads/att_b');
  });

  it('caps the set at MAX_ITEM_PHOTOS', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => `att_${s}`);
    const { service } = makeService({
      attachments: ids.map((id) => ({
        id,
        projectId: null,
        componentId: null,
      })),
    });
    const created = await service.create({
      name: 'Cap',
      photos: ids.map(urlOf),
    });
    expect(created.photos).toHaveLength(5);
  });

  it('deletes what left the set on update', async () => {
    const { service, deleteById } = makeService({
      component: { coverAttachmentId: 'att_old' },
      attachments: [
        { id: 'att_old', projectId: null, componentId: 'comp_1' },
        { id: 'att_keep', projectId: null, componentId: 'comp_1' },
      ],
    });
    await service.update('comp_1', { photos: ['/api/uploads/att_keep'] });
    expect(deleteById).toHaveBeenCalledWith('att_old');
    expect(deleteById).not.toHaveBeenCalledWith('att_keep');
  });

  it('clears the whole set when photos is an empty list', async () => {
    const { service, deleteById, component } = makeService({
      component: { coverAttachmentId: 'att_old' },
      attachments: [{ id: 'att_old', projectId: null, componentId: 'comp_1' }],
    });
    await service.update('comp_1', { photos: [] });
    expect(deleteById).toHaveBeenCalledWith('att_old');
    expect(component.coverAttachmentId).toBeNull();
  });

  it('leaves the set untouched when no photo field is sent', async () => {
    const { service, deleteById, saved } = makeService({
      component: { coverAttachmentId: 'att_old' },
      attachments: [{ id: 'att_old', projectId: null, componentId: 'comp_1' }],
    });
    await service.update('comp_1', { name: 'Renamed' });
    expect(deleteById).not.toHaveBeenCalled();
    expect(saved.some((row) => 'coverAttachmentId' in row)).toBe(false);
  });

  it('does not delete a picture that stayed in the set', async () => {
    const { service, deleteById } = makeService({
      component: { coverAttachmentId: 'att_keep' },
      attachments: [{ id: 'att_keep', projectId: null, componentId: 'comp_1' }],
    });
    await service.update('comp_1', { photos: ['/api/uploads/att_keep'] });
    expect(deleteById).not.toHaveBeenCalled();
  });

  it('deletes every picture when the item is deleted', async () => {
    const { service, deleteById } = makeService({
      attachments: [
        { id: 'att_1', projectId: null, componentId: 'comp_1' },
        { id: 'att_2', projectId: null, componentId: 'comp_1' },
      ],
    });
    await service.delete('comp_1');
    expect(deleteById).toHaveBeenCalledWith('att_1');
    expect(deleteById).toHaveBeenCalledWith('att_2');
  });
});

// The read side: every payload still carries `imageUrl`, derived from the set,
// so nothing that read it before the change had to be touched.
describe('InventoryService photo set — reads', () => {
  function makeReader(
    rows: { id: string; coverAttachmentId: string | null }[],
    photos: Record<string, { id: string; isCover: boolean }[]>,
  ): InventoryService {
    const prisma = {
      component: {
        findMany: jest.fn().mockResolvedValue(rows),
        findUnique: jest.fn().mockResolvedValue(rows[0]),
      },
      projectComponent: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const photosByOwner = jest.fn(
      (owners: { id: string }[]) =>
        Promise.resolve(
          new Map(
            owners.map((owner) => [
              owner.id,
              (photos[owner.id] ?? []).map((photo) => ({
                ...photo,
                url: urlOf(photo.id),
              })),
            ]),
          ),
        ) as Promise<Map<string, unknown>>,
    );
    return new InventoryService(
      prisma as never,
      { t: (key: string) => key } as never,
      { getCapability: () => null } as never,
      { photosByOwner } as never,
      {
        itemCreated: async () => undefined,
        itemChanged: async () => undefined,
        itemDeleted: async () => undefined,
      } as never,
      {
        setValues: () => Promise.resolve(),
        valuesFor: () => Promise.resolve([]),
        effectivePropertiesFor: () => Promise.resolve([]),
        spillForCategoryChange: () => Promise.resolve(),
        filledValuesFor: () => Promise.resolve([]),
      } as never,
      { emit: async () => undefined } as never,
    );
  }

  it('derives imageUrl from the cover of the set', async () => {
    const service = makeReader([{ id: 'c1', coverAttachmentId: 'att_b' }], {
      c1: [
        { id: 'att_a', isCover: false },
        { id: 'att_b', isCover: true },
      ],
    });
    const [row] = await service.findAll();
    expect(row.imageUrl).toBe('/api/uploads/att_b');
    expect(row.photos).toHaveLength(2);
  });

  it('reports no picture for an item with an empty set', async () => {
    const service = makeReader([{ id: 'c1', coverAttachmentId: null }], {});
    const [row] = await service.findAll();
    expect(row.imageUrl).toBeNull();
    expect(row.photos).toEqual([]);
  });

  it('derives it on the single-item read too', async () => {
    const service = makeReader([{ id: 'c1', coverAttachmentId: null }], {
      c1: [{ id: 'att_only', isCover: true }],
    });
    expect((await service.getOne('c1')).imageUrl).toBe('/api/uploads/att_only');
  });
});

// The per-URL provenance rule the agent tools apply BEFORE writing (#218).
//
// `applyPhotoSet` is forgiving — it skips a URL it cannot use and saves the
// rest, which is right for the desktop form and the intake commit, whose lists
// are assembled from pictures already in hand. An agent's list is not evidence
// of anything: forgiveness there let the model name a URL the person never
// showed it and still be told "created", with the missing pictures unmentioned.
describe('InventoryService.assertPhotosAdoptable', () => {
  it('accepts an unowned picture — a chat upload the person just sent', async () => {
    const { service } = makeService({
      attachments: [{ id: 'att_free', projectId: null, componentId: null }],
    });
    await expect(
      service.assertPhotosAdoptable([urlOf('att_free')], null),
    ).resolves.toBeUndefined();
  });

  it("accepts the item's OWN pictures, so re-sending the set to reorder it passes", async () => {
    const { service } = makeService({
      attachments: [{ id: 'att_mine', projectId: null, componentId: 'comp_1' }],
    });
    await expect(
      service.assertPhotosAdoptable([urlOf('att_mine')], 'comp_1'),
    ).resolves.toBeUndefined();
  });

  it('refuses image data — the model supplying a picture of its own', async () => {
    const { service } = makeService();
    await expect(
      service.assertPhotosAdoptable(['data:image/png;base64,AAAA'], null),
    ).rejects.toThrow('inventory.errors.photoNotStored');
  });

  it('refuses a URL that names nothing this caller can read', async () => {
    const { service } = makeService();
    await expect(
      service.assertPhotosAdoptable([urlOf('att_invented')], null),
    ).rejects.toThrow('inventory.errors.photoUnknown');
  });

  it("refuses a project's picture", async () => {
    const { service } = makeService({
      attachments: [{ id: 'att_proj', projectId: 'proj_1', componentId: null }],
    });
    await expect(
      service.assertPhotosAdoptable([urlOf('att_proj')], null),
    ).rejects.toThrow('inventory.errors.photoOwnedElsewhere');
  });

  it("refuses another item's picture", async () => {
    const { service } = makeService({
      attachments: [
        { id: 'att_other', projectId: null, componentId: 'comp_2' },
      ],
    });
    await expect(
      service.assertPhotosAdoptable([urlOf('att_other')], 'comp_1'),
    ).rejects.toThrow('inventory.errors.photoOwnedElsewhere');
  });

  // The point of checking EVERY entry: one legitimate frame must not carry a
  // borrowed one in beside it. The turn-level #72 gate waves the whole list
  // through once the turn is vision-sourced.
  it('refuses the whole list when one entry among good ones fails', async () => {
    const { service } = makeService({
      attachments: [
        { id: 'att_ok', projectId: null, componentId: null },
        { id: 'att_theirs', projectId: 'proj_1', componentId: null },
      ],
    });
    await expect(
      service.assertPhotosAdoptable(
        [urlOf('att_ok'), urlOf('att_theirs')],
        null,
      ),
    ).rejects.toThrow('inventory.errors.photoOwnedElsewhere');
  });
});
