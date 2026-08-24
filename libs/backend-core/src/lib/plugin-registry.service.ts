import { Injectable } from '@nestjs/common';
import { PluginManifest } from '@makekeeper/plugin-contract';

@Injectable()
export class PluginRegistryService {
  private readonly plugins: Map<string, PluginManifest> = new Map();

  register(manifest: PluginManifest) {
    this.plugins.set(manifest.id, manifest);
  }

  getPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): PluginManifest | undefined {
    return this.plugins.get(id);
  }
}
