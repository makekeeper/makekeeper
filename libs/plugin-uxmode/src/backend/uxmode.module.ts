import { Module, OnModuleInit } from '@nestjs/common';
import { PluginRegistryService } from '@makekeeper/backend-core';
import { uxmodeManifest } from '../manifest';

// Backend side of the UX-mode plugin: registration only. The mode itself is a
// client-side display lens (localStorage) — there are no routes, tools or
// models yet. Registering the manifest makes the plugin visible in the plugins
// admin and toggleable per-instance/per-user like any other plugin; a future
// server-side preference sync would live here.
@Module({})
export class UxModePluginModule implements OnModuleInit {
  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(uxmodeManifest);
  }
}
