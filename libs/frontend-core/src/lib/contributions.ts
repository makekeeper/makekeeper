import { computed, type ComputedRef } from 'vue';
import {
  getManifestContributions,
  getSlotContributions,
  pluginRegistryVersion,
  type RegisteredContribution,
} from './registry';
import { usePluginsStore } from './plugins-store';

// The enabled-only view of a slot's contributions (#58): what `<PluginSlot>`
// and bespoke slot hosts actually render. Reactive to the plugins store, so a
// contributor's UI vanishes/returns the moment its instance toggle flips.
// Lives outside registry.ts because the store already imports the registry.
//
// Manifest-driven contributions (#74) are merged in: their target slots are
// declared in the live manifests (e.g. codes mounts a "Print label" button into
// slots hosts declare via `manifest.codes`), so only slots owned by an ENABLED
// host manifest are eligible, in addition to the contributing plugin being
// enabled.
export function useSlotContributions(
  slot: string,
): ComputedRef<RegisteredContribution[]> {
  const plugins = usePluginsStore();
  return computed(() => {
    // Re-run when plugins are registered or removed at runtime (#150).
    void pluginRegistryVersion.value;
    const staticContribs = getSlotContributions(slot).filter((c) =>
      plugins.isEnabled(c.pluginId),
    );
    const enabledManifests = plugins.plugins.filter((m) =>
      plugins.isEnabled(m.id),
    );
    const manifestContribs = getManifestContributions(
      enabledManifests,
      slot,
    ).filter((c) => plugins.isEnabled(c.pluginId));
    return (
      [...staticContribs, ...manifestContribs]
        // A contribution-level `visible` predicate (the simple/pro lens, #269)
        // applies here so every slot host inherits it without changes.
        .filter((c) => c.visible === undefined || c.visible())
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    );
  });
}
