import { defineAsyncComponent, type Component } from 'vue';
import {
  ArrowLeftRight,
  Blocks,
  Bot,
  Box,
  ChartColumn,
  DatabaseBackup,
  FolderGit,
  FolderTree,
  Hammer,
  HardDrive,
  Layers,
  QrCode,
  RefreshCw,
  Settings,
  Share2,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Truck,
  UserRound,
  Users,
  Wrench,
} from '@lucide/vue';

// Plugins declare an icon by NAME (a string in their manifest). This is the one
// registry that maps those names to lucide components — previously copied, and
// already diverged, across the shell and four settings/admin views, so a new
// manifest icon silently rendered the Box fallback wherever a copy lagged.
//
// The names are kept in sync with every `icon:` a manifest declares by
// `plugin-icons.spec.ts`, which fails when a manifest references a name absent
// here — importing the full ~6000-icon lucide set to resolve names dynamically
// would defeat tree-shaking, so the guarded whitelist stays.
const PLUGIN_ICONS: Record<string, Component> = {
  ArrowLeftRight,
  Blocks,
  Bot,
  Box,
  ChartColumn,
  DatabaseBackup,
  FolderGit,
  FolderTree,
  Hammer,
  HardDrive,
  Layers,
  QrCode,
  RefreshCw,
  Settings,
  Share2,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Truck,
  UserRound,
  Users,
  Wrench,
};

// Names we do NOT control resolve against the whole lucide set, lazily.
//
// The whitelist above is curated for OUR manifests, so every external plugin —
// which picks its icon from the full set — rendered the same Box, and a
// sidebar with three of them was three identical squares. The set is imported
// only when such a name is actually asked for, so an instance with no external
// plugins keeps the tree-shaken build it has today and everyone else pays for
// one extra chunk, once.
const lazyIcons = new Map<string, Component>();

// Resolve a manifest icon name to its component: the shipped set first, then
// the lazy lookup, then Box.
export function resolvePluginIcon(name: string | null | undefined): Component {
  if (!name) return Box;
  const known = PLUGIN_ICONS[name];
  if (known) return known;
  const cached = lazyIcons.get(name);
  if (cached) return cached;
  const component = defineAsyncComponent({
    loader: async () => {
      const module = (await import('@lucide/vue')) as unknown as Record<
        string,
        Component
      >;
      // A name that is not an icon (a typo, a made-up one) falls back rather
      // than rendering nothing — the plugin is still usable without its icon.
      return module[name] ?? Box;
    },
    // Nothing while it loads: an icon that flashes a placeholder is worse than
    // an icon that appears a moment late.
    loadingComponent: undefined,
    errorComponent: Box,
  });
  lazyIcons.set(name, component);
  return component;
}

// Whether a manifest icon name has an explicit mapping (i.e. would NOT hit the
// Box fallback). The drift guard in `plugin-icons.spec.ts` uses this.
export function isKnownPluginIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLUGIN_ICONS, name);
}
