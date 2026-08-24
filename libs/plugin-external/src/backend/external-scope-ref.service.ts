import { Injectable } from '@nestjs/common';
import { PrismaService, RequestContextService } from '@makekeeper/backend-core';
import { ExternalRegistryService } from './external-registry.service';
import { deriveScopeRef } from './external-user-ref';

// Translates between the core's internal scope ids and the OPAQUE per-plugin
// scope references the contract promises (decision #5). Every scopeId that
// crosses the boundary to a plugin container goes through toRef(); the rare
// inbound direction (an instance-class token naming a scope in
// notify-changed) resolves with fromRef().
//
// fromRef() has no reverse function — the ref is a truncated HMAC — so it
// re-derives over the known scopes and matches. Scopes are users, users are
// few; if that ever changes, add a mapping table, not a reversible ref.

@Injectable()
export class ExternalScopeRefService {
  // The salt never rotates (the ref IS an identity the plugin stores), so a
  // per-process cache can never serve a stale value.
  private readonly salts = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExternalRegistryService,
    private readonly context: RequestContextService,
  ) {}

  // null (single-user mode's implicit space) stays null: there is nothing to
  // hide and the SDK already reads a missing scope as "no particular scope".
  async toRef(
    pluginId: string,
    scopeId: string | null,
  ): Promise<string | null> {
    if (!scopeId) return null;
    const salt = await this.salt(pluginId);
    return salt ? deriveScopeRef(salt, scopeId) : null;
  }

  async fromRef(pluginId: string, ref: string): Promise<string | null> {
    const salt = await this.salt(pluginId);
    if (!salt) return null;
    const users = await this.context.runWithoutScope(
      'admin-cross-user',
      async () => this.prisma.user.findMany({ select: { id: true } }),
    );
    for (const user of users) {
      if (deriveScopeRef(salt, user.id) === ref) return user.id;
    }
    return null;
  }

  private async salt(pluginId: string): Promise<string | null> {
    const cached = this.salts.get(pluginId);
    if (cached) return cached;
    const salt = await this.registry.userRefSalt(pluginId);
    if (salt) this.salts.set(pluginId, salt);
    return salt;
  }
}
