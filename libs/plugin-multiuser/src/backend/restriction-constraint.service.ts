import { Injectable, Logger } from '@nestjs/common';
import { ScopeGrant } from '@prisma/client';
import {
  ScopeRestrictionRegistryService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { ModelConstraintMap } from '@makekeeper/plugin-contract';
import { SCOPE_MODEL_MAP } from './scope-model-map';

const CACHE_MAX_ENTRIES = 200;

// A grant's resource selection is data-driven (descriptors may expand subtrees
// from the DB). The cache key is only grant version, so a short TTL bounds how
// long a since-changed subtree membership can be served — matching the guard's
// other hot-path lookups (grants/users services). Successful builds only.
const CACHE_TTL_MS = 30_000;

// The fail-closed sentinel: an impossible (`id in []`) fragment for every
// scope-shared model, so `buildFilters` narrows each of them to zero rows. Only
// scope-bound models are listed — user-private rows are never grant-restricted
// (see ScopePolicyService.buildFilters), so the grantee keeps their own data.
// A conditional model (`Attachment`) is listed and that is deliberate: the
// policy applies constraints to its SHARED half only, so a failed descriptor
// hides the scope's files without touching the caller's own private ones.
const DENY_ALL_SHARED: ModelConstraintMap = Object.fromEntries(
  Object.entries(SCOPE_MODEL_MAP)
    .filter(([, rule]) => rule.kind !== 'unscoped' && rule.binding !== 'user')
    .map(([model]) => [model, { id: { in: [] } }]),
);

// Translates a grant's stored resource selections into per-model Prisma
// where-fragments via the plugin-announced descriptors. Cached per grant
// version (id + updatedAt) with a short TTL — descriptors may hit the DB
// (subtree expansion), and the guard needs this on every shared-scope request.
@Injectable()
export class RestrictionConstraintService {
  private readonly logger = new Logger(RestrictionConstraintService.name);
  private readonly cache = new Map<
    string,
    { maps: ModelConstraintMap[]; expiresAt: number }
  >();

  constructor(private readonly registry: ScopeRestrictionRegistryService) {}

  async buildForGrant(grant: ScopeGrant): Promise<ModelConstraintMap[]> {
    const key = `${grant.id}:${grant.updatedAt.getTime()}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.maps;

    let maps: ModelConstraintMap[];
    try {
      maps = await this.buildMaps(grant);
    } catch (error) {
      // Fail CLOSED: a restriction we cannot resolve (transient DB error, or a
      // descriptor no longer announced because its plugin was removed) must
      // DENY the shared scope's data, never widen the grant to the owner's
      // whole dataset. Not cached, so it self-heals once the cause clears.
      this.logger.error(
        `Restriction build for grant ${grant.id} failed; denying shared data: ${getErrorMessage(error)}`,
      );
      return [DENY_ALL_SHARED];
    }

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { maps, expiresAt: Date.now() + CACHE_TTL_MS });
    return maps;
  }

  // Throws on any unresolvable restriction so the caller can fail closed.
  private async buildMaps(grant: ScopeGrant): Promise<ModelConstraintMap[]> {
    const maps: ModelConstraintMap[] = [];
    for (const [pluginId, byResource] of Object.entries(
      this.parse(grant.resourceRestrictions),
    )) {
      for (const [resourceKey, ids] of Object.entries(byResource)) {
        // Empty selection = the grant covers the plugin's whole scope data.
        if (ids.length === 0) continue;
        const descriptor = this.registry.get(pluginId, resourceKey);
        if (!descriptor) {
          throw new Error(
            `Grant references unannounced restriction "${pluginId}:${resourceKey}"`,
          );
        }
        maps.push(
          await descriptor.buildModelConstraints(grant.ownerUserId, ids),
        );
      }
    }
    return maps;
  }

  clear(): void {
    this.cache.clear();
  }

  private parse(raw: string): Record<string, Record<string, string[]>> {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const result: Record<string, Record<string, string[]>> = {};
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
