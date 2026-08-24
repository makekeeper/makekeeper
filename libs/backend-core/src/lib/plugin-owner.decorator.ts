import { SetMetadata } from '@nestjs/common';

// Metadata key naming the plugin that owns a controller (or handler). Read by
// the PluginEnabledGuard to gate requests when the plugin is disabled.
export const PLUGIN_OWNER_KEY = 'pluginOwner';

// Tag a plugin's controller with its plugin id, e.g. `@PluginOwner('inventory')`.
// Controllers without this decorator (core app routes) are never gated.
export const PluginOwner = (pluginId: string) =>
  SetMetadata(PLUGIN_OWNER_KEY, pluginId);
