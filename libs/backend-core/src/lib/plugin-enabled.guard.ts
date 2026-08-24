import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLUGIN_OWNER_KEY } from './plugin-owner.decorator';
import { PluginConfigService } from './plugin-config.service';
import { PluginI18nService } from './plugin-i18n.service';

// Global guard: for any handler/controller tagged with `@PluginOwner(id)`, it
// blocks the request (404) when that plugin is disabled. Untagged (core) routes
// always pass. Reads the in-memory enabled cache, so it adds no DB round-trip.
@Injectable()
export class PluginEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pluginConfig: PluginConfigService,
    private readonly i18n: PluginI18nService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const pluginId = this.reflector.getAllAndOverride<string | undefined>(
      PLUGIN_OWNER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!pluginId) return true;
    if (this.pluginConfig.isEnabled(pluginId)) return true;
    // 404 rather than 403 — a disabled plugin behaves as if it isn't there.
    throw new NotFoundException(
      this.i18n.t('core.errors.pluginDisabled', { pluginId }),
    );
  }
}
