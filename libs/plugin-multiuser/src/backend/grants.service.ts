import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScopeGrant } from '@prisma/client';
import {
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
  ScopeRestrictionRegistryService,
  generateUuid,
} from '@makekeeper/backend-core';
import {
  GrantPublic,
  GrantResourceRestrictions,
  ScopeAccessLevel,
} from '@makekeeper/plugin-contract';
import { UsersService } from './users.service';
import { RestrictionConstraintService } from './restriction-constraint.service';
import { CreateGrantDto, UpdateGrantDto } from './multiuser.dto';

const LOOKUP_TTL_MS = 30_000;

// Scope grants: the owner-side CRUD used by the sharing UI, plus the cached
// (owner, grantee) lookup the guard performs on every shared-scope request.
@Injectable()
export class GrantsService {
  private readonly lookupCache = new Map<
    string,
    { grant: ScopeGrant | null; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly plugins: PluginRegistryService,
    private readonly restrictions: ScopeRestrictionRegistryService,
    private readonly constraints: RestrictionConstraintService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Guard hot path — cached with a short TTL; invalidated on every write.
  async findActive(
    ownerUserId: string,
    granteeUserId: string,
  ): Promise<ScopeGrant | null> {
    const key = `${ownerUserId}:${granteeUserId}`;
    const cached = this.lookupCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.grant;
    const grant = await this.prisma.scopeGrant.findUnique({
      where: { ownerUserId_granteeUserId: { ownerUserId, granteeUserId } },
    });
    this.lookupCache.set(key, { grant, expiresAt: Date.now() + LOOKUP_TTL_MS });
    return grant;
  }

  async listForOwner(ownerUserId: string): Promise<GrantPublic[]> {
    const grants = await this.prisma.scopeGrant.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: 'asc' },
    });
    // Resolve grantees concurrently instead of serializing one lookup per grant.
    const grantees = await Promise.all(
      grants.map((grant) => this.users.getById(grant.granteeUserId)),
    );
    const result: GrantPublic[] = [];
    grants.forEach((grant, i) => {
      const grantee = grantees[i];
      if (grantee)
        result.push(this.toPublic(grant, this.users.toPublic(grantee)));
    });
    return result;
  }

  async create(
    ownerUserId: string,
    dto: CreateGrantDto,
    locale?: string,
  ): Promise<GrantPublic> {
    if (dto.granteeUserId === ownerUserId) {
      throw new BadRequestException(
        this.i18n.t('multiuser.errors.cannotGrantSelf', undefined, locale),
      );
    }
    const grantee = await this.users.getById(dto.granteeUserId);
    if (!grantee) {
      throw new NotFoundException(
        this.i18n.t('multiuser.errors.unknownUser', undefined, locale),
      );
    }
    const existing = await this.prisma.scopeGrant.findUnique({
      where: {
        ownerUserId_granteeUserId: {
          ownerUserId,
          granteeUserId: dto.granteeUserId,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        this.i18n.t('multiuser.errors.grantExists', undefined, locale),
      );
    }
    const restrictions = this.validateRestrictions(
      dto.resourceRestrictions,
      locale,
    );
    this.validatePluginIds(dto.allowedPluginIds, locale);
    const grant = await this.prisma.scopeGrant.create({
      data: {
        id: generateUuid(),
        ownerUserId,
        granteeUserId: dto.granteeUserId,
        accessLevel: dto.accessLevel,
        allowedPluginIds: JSON.stringify(dto.allowedPluginIds),
        resourceRestrictions: JSON.stringify(restrictions),
      },
    });
    this.invalidateCaches();
    return this.toPublic(grant, this.users.toPublic(grantee));
  }

  async update(
    ownerUserId: string,
    grantId: string,
    dto: UpdateGrantDto,
    locale?: string,
  ): Promise<GrantPublic> {
    const grant = await this.requireOwnGrant(ownerUserId, grantId, locale);
    const data: Record<string, string> = {};
    if (dto.accessLevel !== undefined) data.accessLevel = dto.accessLevel;
    if (dto.allowedPluginIds !== undefined) {
      this.validatePluginIds(dto.allowedPluginIds, locale);
      data.allowedPluginIds = JSON.stringify(dto.allowedPluginIds);
    }
    if (dto.resourceRestrictions !== undefined) {
      data.resourceRestrictions = JSON.stringify(
        this.validateRestrictions(dto.resourceRestrictions, locale),
      );
    }
    const updated = await this.prisma.scopeGrant.update({
      where: { id: grant.id },
      data,
    });
    this.invalidateCaches();
    const grantee = await this.users.getById(updated.granteeUserId);
    if (!grantee) {
      throw new NotFoundException(
        this.i18n.t('multiuser.errors.unknownUser', undefined, locale),
      );
    }
    return this.toPublic(updated, this.users.toPublic(grantee));
  }

  async remove(
    ownerUserId: string,
    grantId: string,
    locale?: string,
  ): Promise<void> {
    const grant = await this.requireOwnGrant(ownerUserId, grantId, locale);
    await this.prisma.scopeGrant.delete({ where: { id: grant.id } });
    this.invalidateCaches();
  }

  clearCaches(): void {
    this.lookupCache.clear();
  }

  private invalidateCaches(): void {
    this.lookupCache.clear();
    this.constraints.clear();
  }

  private async requireOwnGrant(
    ownerUserId: string,
    grantId: string,
    locale?: string,
  ): Promise<ScopeGrant> {
    const grant = await this.prisma.scopeGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) {
      throw new NotFoundException(
        this.i18n.t('multiuser.errors.unknownGrant', undefined, locale),
      );
    }
    if (grant.ownerUserId !== ownerUserId) {
      throw new ForbiddenException(
        this.i18n.t('multiuser.errors.notGrantOwner', undefined, locale),
      );
    }
    return grant;
  }

  private validatePluginIds(pluginIds: string[], locale?: string): void {
    for (const pluginId of pluginIds) {
      if (!this.plugins.getPlugin(pluginId)) {
        throw new BadRequestException(
          this.i18n.t('core.errors.unknownPlugin', { pluginId }, locale),
        );
      }
    }
  }

  // Narrows the DTO's loose object into the announced-restrictions shape and
  // rejects selections for descriptors no plugin announced.
  private validateRestrictions(
    raw: Record<string, unknown>,
    locale?: string,
  ): GrantResourceRestrictions {
    const result: GrantResourceRestrictions = {};
    for (const [pluginId, byResource] of Object.entries(raw)) {
      if (typeof byResource !== 'object' || byResource === null) {
        throw new BadRequestException(
          this.i18n.t(
            'multiuser.errors.invalidRestrictions',
            undefined,
            locale,
          ),
        );
      }
      const target: Record<string, string[]> = {};
      for (const [resourceKey, ids] of Object.entries(byResource)) {
        if (!this.restrictions.get(pluginId, resourceKey)) {
          throw new BadRequestException(
            this.i18n.t(
              'multiuser.errors.unknownRestriction',
              undefined,
              locale,
            ),
          );
        }
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
          throw new BadRequestException(
            this.i18n.t(
              'multiuser.errors.invalidRestrictions',
              undefined,
              locale,
            ),
          );
        }
        target[resourceKey] = ids.filter(
          (id): id is string => typeof id === 'string',
        );
      }
      result[pluginId] = target;
    }
    return result;
  }

  private toPublic(
    grant: ScopeGrant,
    grantee: GrantPublic['grantee'],
  ): GrantPublic {
    return {
      id: grant.id,
      grantee,
      accessLevel: this.parseAccessLevel(grant.accessLevel),
      allowedPluginIds: this.parseStringArray(grant.allowedPluginIds),
      resourceRestrictions: this.parseRestrictions(grant.resourceRestrictions),
    };
  }

  private parseAccessLevel(raw: string): ScopeAccessLevel {
    return raw === 'WRITE' ? 'WRITE' : 'READ';
  }

  private parseStringArray(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private parseRestrictions(raw: string): GrantResourceRestrictions {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const result: GrantResourceRestrictions = {};
      for (const [pluginId, byResource] of Object.entries(parsed)) {
        if (typeof byResource !== 'object' || byResource === null) continue;
        const target: Record<string, string[]> = {};
        for (const [resourceKey, ids] of Object.entries(byResource)) {
          if (Array.isArray(ids)) {
            target[resourceKey] = ids.filter(
              (id): id is string => typeof id === 'string',
            );
          }
        }
        result[pluginId] = target;
      }
      return result;
    } catch {
      return {};
    }
  }
}
