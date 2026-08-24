import { Test } from '@nestjs/testing';
import { ScopeGrant } from '@prisma/client';
import { ScopeRestrictionRegistryService } from '@makekeeper/backend-core';
import type { ScopeRestrictionDescriptor } from '@makekeeper/plugin-contract';
import { RestrictionConstraintService } from './restriction-constraint.service';

describe('RestrictionConstraintService', () => {
  let service: RestrictionConstraintService;
  let get: jest.Mock;

  beforeEach(async () => {
    get = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RestrictionConstraintService,
        { provide: ScopeRestrictionRegistryService, useValue: { get } },
      ],
    }).compile();
    service = moduleRef.get(RestrictionConstraintService);
  });

  const grant = (resourceRestrictions: unknown): ScopeGrant =>
    ({
      id: 'g1',
      ownerUserId: 'owner1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      resourceRestrictions: JSON.stringify(resourceRestrictions),
    }) as unknown as ScopeGrant;

  // An impossible fragment (`id in []`) matches no rows: the fail-closed sentinel.
  const isDenyAll = (
    maps: Awaited<ReturnType<typeof service.buildForGrant>>,
  ): boolean =>
    maps.length === 1 &&
    Object.values(maps[0]).every(
      (fragment) =>
        JSON.stringify(fragment) === JSON.stringify({ id: { in: [] } }),
    ) &&
    Object.keys(maps[0]).length > 0;

  it('resolves announced restrictions into per-model constraints', async () => {
    const descriptor: Pick<
      ScopeRestrictionDescriptor,
      'buildModelConstraints'
    > = {
      buildModelConstraints: jest
        .fn()
        .mockResolvedValue({ Project: { id: { in: ['p1'] } } }),
    };
    get.mockReturnValue(descriptor);

    const maps = await service.buildForGrant(
      grant({ projects: { project: ['p1'] } }),
    );
    expect(maps).toEqual([{ Project: { id: { in: ['p1'] } } }]);
  });

  it('fails CLOSED (deny-all) when a descriptor is no longer announced', async () => {
    get.mockReturnValue(undefined);
    const maps = await service.buildForGrant(
      grant({ storages: { storage: ['s1'] } }),
    );
    expect(isDenyAll(maps)).toBe(true);
  });

  it('fails CLOSED (deny-all) when building constraints throws', async () => {
    get.mockReturnValue({
      buildModelConstraints: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const maps = await service.buildForGrant(
      grant({ storages: { storage: ['s1'] } }),
    );
    expect(isDenyAll(maps)).toBe(true);
  });

  it('does not cache a failed build (self-heals on recovery)', async () => {
    const buildModelConstraints = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ Storage: { id: { in: ['s1'] } } });
    get.mockReturnValue({ buildModelConstraints });

    const g = grant({ storages: { storage: ['s1'] } });
    const first = await service.buildForGrant(g);
    expect(isDenyAll(first)).toBe(true);
    // Same grant version, but the earlier failure must NOT have been cached.
    const second = await service.buildForGrant(g);
    expect(second).toEqual([{ Storage: { id: { in: ['s1'] } } }]);
  });

  it('treats an empty selection as "whole plugin scope" (no constraint)', async () => {
    get.mockReturnValue({ buildModelConstraints: jest.fn() });
    const maps = await service.buildForGrant(
      grant({ projects: { project: [] } }),
    );
    expect(maps).toEqual([]);
  });
});
