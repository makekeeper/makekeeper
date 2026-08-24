import {
  AgentRegistryService,
  PluginI18nService,
  PrismaService,
} from '@makekeeper/backend-core';
import { TagsService } from './tags.service';

// Unit tests for the tags service (#60): tag-name uniqueness (incl. the NULL
// single-user scope), assign validation through the ORef resolver, and the lazy
// prune of links whose target no longer exists.
describe('TagsService', () => {
  let service: TagsService;
  let tag: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let tagLink: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    deleteMany: jest.Mock;
  };
  let resolveObjectRef: jest.Mock;

  beforeEach(() => {
    tag = {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(args.data),
      ),
      update: jest.fn(),
      delete: jest.fn(() => Promise.resolve(undefined)),
    };
    tagLink = {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(() => Promise.resolve(undefined)),
      count: jest.fn(() => Promise.resolve(0)),
      deleteMany: jest.fn(() => Promise.resolve(undefined)),
    };
    resolveObjectRef = jest.fn();

    const prisma = { tag, tagLink } as unknown as PrismaService;
    const agentRegistry = {
      resolveObjectRef,
    } as unknown as AgentRegistryService;
    // i18n.t echoes the key so thrown errors are identifiable in assertions.
    const i18n = { t: (key: string) => key } as unknown as PluginI18nService;

    service = new TagsService(prisma, agentRegistry, i18n);
  });

  describe('createTag', () => {
    it('rejects a duplicate name case-insensitively (incl. NULL scope)', async () => {
      tag.findFirst.mockResolvedValue({
        id: 't1',
        name: 'Rework',
        color: 'slate',
      });
      await expect(service.createTag({ name: 'rework' })).rejects.toThrow(
        'tags.errors.duplicateName',
      );
      expect(tag.create).not.toHaveBeenCalled();
    });

    it('creates when the name is free', async () => {
      tag.findFirst.mockResolvedValue(null);
      const dto = await service.createTag({ name: 'RF', color: 'sky' });
      expect(tag.create).toHaveBeenCalled();
      expect(dto.name).toBe('RF');
      expect(dto.color).toBe('sky');
      expect(dto.ref).toMatch(/^mk:\/\/tags\/tag\//);
    });

    it('accepts a custom hex colour and falls back on garbage', async () => {
      tag.findFirst.mockResolvedValue(null);
      const hex = await service.createTag({ name: 'a', color: '#3b82f6' });
      expect(hex.color).toBe('#3b82f6');
      const bad = await service.createTag({ name: 'b', color: 'not-a-color' });
      expect(bad.color).toBe('slate');
    });
  });

  describe('assign', () => {
    it('rejects an unparseable target ref', async () => {
      await expect(service.assign('t1', 'not-a-ref')).rejects.toThrow(
        'tags.errors.invalidRef',
      );
      expect(resolveObjectRef).not.toHaveBeenCalled();
    });

    it('rejects a target that does not resolve (out of scope / missing)', async () => {
      resolveObjectRef.mockResolvedValue({ exists: false });
      await expect(
        service.assign('t1', 'mk://projects/project/p1'),
      ).rejects.toThrow('tags.errors.targetNotFound');
    });

    it('is idempotent on the (tag, ref) pair', async () => {
      resolveObjectRef.mockResolvedValue({ exists: true, displayName: 'P1' });
      tag.findFirst.mockResolvedValue({ id: 't1', name: 'rf', color: 'slate' });
      tagLink.findFirst.mockResolvedValue({ id: 'link-1' }); // already linked
      await service.assign('t1', 'mk://projects/project/p1');
      expect(tagLink.create).not.toHaveBeenCalled();
    });

    it('creates the link when absent', async () => {
      resolveObjectRef.mockResolvedValue({ exists: true, displayName: 'P1' });
      tag.findFirst.mockResolvedValue({ id: 't1', name: 'rf', color: 'slate' });
      tagLink.findFirst.mockResolvedValue(null);
      await service.assign('t1', 'mk://projects/project/p1');
      expect(tagLink.create).toHaveBeenCalled();
    });
  });

  describe('objectsForTag', () => {
    it('prunes links whose target no longer exists and keeps the rest', async () => {
      tagLink.findMany.mockResolvedValue([
        { id: 'l1', ref: 'mk://projects/project/gone' },
        { id: 'l2', ref: 'mk://projects/project/live' },
      ]);
      resolveObjectRef.mockImplementation((ref: string) =>
        ref.endsWith('live')
          ? Promise.resolve({
              exists: true,
              displayName: 'Live',
              breadcrumb: 'B',
            })
          : Promise.resolve({ exists: false }),
      );

      const out = await service.objectsForTag('t1');

      expect(tagLink.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['l1'] } },
      });
      expect(out).toEqual([
        {
          ref: 'mk://projects/project/live',
          displayName: 'Live',
          breadcrumb: 'B',
        },
      ]);
    });

    it('keeps a link as unavailable when its owner plugin is disabled', async () => {
      tagLink.findMany.mockResolvedValue([
        { id: 'l1', ref: 'mk://logistics/order/o1' },
      ]);
      resolveObjectRef.mockResolvedValue(null); // disabled / no resolver

      const out = await service.objectsForTag('t1');

      expect(tagLink.deleteMany).not.toHaveBeenCalled();
      expect(out).toEqual([
        {
          ref: 'mk://logistics/order/o1',
          displayName: null,
          breadcrumb: null,
        },
      ]);
    });
  });
});
