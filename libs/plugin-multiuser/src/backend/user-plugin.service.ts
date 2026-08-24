import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  PluginConfigService,
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import { MyPluginState } from '@makekeeper/plugin-contract';
import { multiuserManifest } from '../manifest';

const CACHE_TTL_MS = 30_000;

// Per-user plugin enablement (the overlay on top of the instance-level
// PluginConfig) and the effective-set computation the guard stamps into the
// request context on every request.
@Injectable()
export class UserPluginService {
  private readonly disabledCache = new Map<
    string,
    { disabled: Set<string>; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
    private readonly pluginConfig: PluginConfigService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Effective plugin set: instance-enabled ∧ user-enabled ∧ (in a shared
  // scope) grant-allowed. Core plugins and the multiuser plugin itself always
  // pass the user/grant layers — they carry no scope data, and stripping them
  // would lock the user out of settings/auth surfaces.
  async effectiveSet(
    userId: string,
    grantAllowedPluginIds: string[] | null,
  ): Promise<ReadonlySet<string>> {
    const userDisabled = await this.getUserDisabled(userId);
    const allowed = grantAllowedPluginIds
      ? new Set(grantAllowedPluginIds)
      : null;
    const result = new Set<string>();
    for (const plugin of this.registry.getPlugins()) {
      if (!this.pluginConfig.isEnabled(plugin.id)) continue;
      const exempt = plugin.core === true || plugin.id === multiuserManifest.id;
      if (!exempt && userDisabled.has(plugin.id)) continue;
      if (!exempt && allowed && !allowed.has(plugin.id)) continue;
      result.add(plugin.id);
    }
    return result;
  }

  async getStatesFor(userId: string): Promise<MyPluginState[]> {
    const userDisabled = await this.getUserDisabled(userId);
    return this.registry
      .getPlugins()
      .filter(
        (plugin) => plugin.core !== true && plugin.id !== multiuserManifest.id,
      )
      .map((plugin) => ({
        pluginId: plugin.id,
        isEnabled: !userDisabled.has(plugin.id),
      }));
  }

  async setEnabled(
    userId: string,
    pluginId: string,
    isEnabled: boolean,
    locale?: string,
  ): Promise<void> {
    const plugin = this.registry.getPlugin(pluginId);
    if (!plugin) {
      throw new ForbiddenException(
        this.i18n.t('core.errors.unknownPlugin', { pluginId }, locale),
      );
    }
    if (plugin.core === true || plugin.id === multiuserManifest.id) {
      throw new ForbiddenException(
        this.i18n.t(
          'multiuser.errors.pluginNotUserToggleable',
          undefined,
          locale,
        ),
      );
    }
    await this.prisma.userPluginConfig.upsert({
      where: { userId_pluginId: { userId, pluginId } },
      create: { userId, pluginId, isEnabled },
      update: { isEnabled },
    });
    this.disabledCache.delete(userId);
  }

  clearCaches(): void {
    this.disabledCache.clear();
  }

  private async getUserDisabled(userId: string): Promise<Set<string>> {
    const cached = this.disabledCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.disabled;
    const rows = await this.prisma.userPluginConfig.findMany({
      where: { userId, isEnabled: false },
      select: { pluginId: true },
    });
    const disabled = new Set(rows.map((row) => row.pluginId));
    this.disabledCache.set(userId, {
      disabled,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return disabled;
  }
}
