import {
  Injectable,
  Logger,
  ForbiddenException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginI18nService } from './plugin-i18n.service';
import { getErrorMessage } from './error';

// Initializer hooks a plugin may register for its own enable/disable
// transitions (e.g. the multiuser overlay backfills orphan rows on enable and
// drops caches on disable). Best-effort by design: a failing hook is logged
// but does not roll the state change back.
export interface PluginLifecycleHooks {
  onEnabled?: () => Promise<void>;
  onDisabled?: () => Promise<void>;
}

// Owns per-plugin enable/disable state. Backed by the `PluginConfig` table and
// an in-memory cache read on every request by the PluginEnabledGuard, so the
// hot path never hits the DB. A missing row means "enabled".
@Injectable()
export class PluginConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PluginConfigService.name);
  private readonly enabled = new Map<string, boolean>();
  private readonly lifecycleHooks = new Map<string, PluginLifecycleHooks>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows = await this.prisma.pluginConfig.findMany();
      for (const row of rows) this.enabled.set(row.pluginId, row.isEnabled);

      // Seed a row for every registered plugin that has none yet. Most default
      // on; opt-in overlays declare `defaultEnabled: false` in their manifest.
      for (const plugin of this.registry.getPlugins()) {
        if (!this.enabled.has(plugin.id)) {
          const isEnabled = plugin.defaultEnabled !== false;
          await this.prisma.pluginConfig.create({
            data: { pluginId: plugin.id, isEnabled },
          });
          this.enabled.set(plugin.id, isEnabled);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to load plugin config: ${getErrorMessage(error)}`,
      );
    }
  }

  // Fast, synchronous check for the request/tool hot paths. Unknown → enabled.
  isEnabled(pluginId: string): boolean {
    return this.enabled.get(pluginId) ?? true;
  }

  // Current state of every registered plugin (merged with the enabled cache).
  getStates(): { pluginId: string; isEnabled: boolean }[] {
    return this.registry.getPlugins().map((plugin) => ({
      pluginId: plugin.id,
      isEnabled: this.isEnabled(plugin.id),
    }));
  }

  // Register enable/disable initializers for one plugin (see
  // `PluginLifecycleHooks`). Called from the plugin module's onModuleInit.
  registerLifecycleHooks(pluginId: string, hooks: PluginLifecycleHooks): void {
    this.lifecycleHooks.set(pluginId, hooks);
  }

  async setEnabled(pluginId: string, isEnabled: boolean): Promise<void> {
    const plugin = this.registry.getPlugin(pluginId);
    if (!plugin) {
      throw new ForbiddenException(
        this.i18n.t('core.errors.unknownPlugin', { pluginId }),
      );
    }
    // Core plugins (e.g. the settings admin itself) cannot be disabled.
    if (plugin.core && !isEnabled) {
      throw new ForbiddenException(
        this.i18n.t('core.errors.pluginCoreCannotDisable', { pluginId }),
      );
    }
    const wasEnabled = this.isEnabled(pluginId);
    await this.prisma.pluginConfig.upsert({
      where: { pluginId },
      create: { pluginId, isEnabled },
      update: { isEnabled },
    });
    this.enabled.set(pluginId, isEnabled);

    if (wasEnabled !== isEnabled) {
      await this.invokeLifecycleHook(pluginId, isEnabled);
    }
  }

  private async invokeLifecycleHook(
    pluginId: string,
    isEnabled: boolean,
  ): Promise<void> {
    const hooks = this.lifecycleHooks.get(pluginId);
    const hook = isEnabled ? hooks?.onEnabled : hooks?.onDisabled;
    if (!hook) return;
    try {
      await hook();
    } catch (error) {
      this.logger.error(
        `Lifecycle hook (${isEnabled ? 'onEnabled' : 'onDisabled'}) for plugin ` +
          `"${pluginId}" failed: ${getErrorMessage(error)}`,
      );
    }
  }
}
