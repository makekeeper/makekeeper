import { Injectable } from '@nestjs/common';
import { ExternalRegistryService } from './external-registry.service';
import type { ExternalShellPlugin } from '../external-types';

// The shell projection (#134): what the SPA needs to MOUNT external plugins,
// derived entirely from the manifests cached at install. Deliberately does not
// touch a single plugin container — the sidebar, routes, widget placeholders
// and i18n must exist while every external plugin is down, restarting or
// mid-deploy (decision #4).
@Injectable()
export class ExternalShellService {
  constructor(private readonly registry: ExternalRegistryService) {}

  async shell(): Promise<ExternalShellPlugin[]> {
    const active = await this.registry.listActive();
    return active.map(({ manifest }) => ({
      pluginId: manifest.pluginId,
      nameKey: manifest.nameKey,
      icon: manifest.icon,
      version: manifest.version,
      screens: manifest.screens,
      nav: manifest.nav ?? [],
      widgets: manifest.widgets ?? [],
      slots: manifest.slots ?? [],
      settingsScreen: manifest.settingsScreen,
      objectRefs: manifest.objectRefs ?? [],
      uxFeatures: manifest.uxFeatures ?? [],
      i18n: manifest.i18n,
    }));
  }
}
