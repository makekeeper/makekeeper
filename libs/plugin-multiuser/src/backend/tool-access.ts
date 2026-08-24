import { PermissionLevel, type AgentTool } from '@makekeeper/plugin-contract';

// Which tools the overlay lets the assistant see, as a pure rule.
//
// It lived inline in the module and quietly disabled an entire class of
// plugin: the per-user set is built from the INTERNAL plugin registry, so an
// external plugin's id is never in it, and every external tool was dropped for
// every user while the overlay was on. Out here it can be stated once and
// tested.

export interface ToolAccessContext {
  // Absent ⇒ the overlay is off (or the guard did not run): no filtering.
  enabledPluginIds?: ReadonlySet<string>;
  accessLevel?: string;
}

export function toolIsAccessible(
  tool: Pick<AgentTool, 'pluginId' | 'permission' | 'external'>,
  rc: ToolAccessContext | undefined,
): boolean {
  if (!rc?.enabledPluginIds) return true;

  // An external plugin is an instance-level decision today — installed and
  // consented to by an admin — and has no per-user opt-out to honour. When it
  // gains one, it belongs in `effectiveSet` and this exemption goes with it.
  if (!tool.external && !rc.enabledPluginIds.has(tool.pluginId)) return false;

  // A scope shared READ-only stays read-only for the assistant too: it may
  // look, never touch.
  if (rc.accessLevel === 'READ' && tool.permission !== PermissionLevel.READ) {
    return false;
  }
  return true;
}
