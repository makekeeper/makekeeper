// Shape of the instance-wide agent tool policy, as served by
// `GET /api/settings/agent-tools`. Lives next to the view rather than inside it
// since #265 split the page into one section component per plugin — both halves
// need the types, and a section must not import a `.vue` file for them.

export type ConfirmationPolicy = 'AUTO' | 'CONFIRM';

export type ToolPermission = 'READ' | 'WRITE' | 'DESTRUCTIVE';

export interface AgentToolConfig {
  name: string;
  // i18n key resolved with `$t` in the template — never a raw literal.
  descriptionKey: string;
  permission: ToolPermission;
  isEnabled: boolean;
  confirmationPolicy: ConfirmationPolicy;
  // Proxied to a third-party plugin (#137): its gate cannot be relaxed to
  // auto-run, so the option is not offered (the backend refuses it too).
  external?: boolean;
}

export interface AgentToolGroup {
  pluginId: string;
  // i18n key resolved with `$t` in the template — never a raw literal.
  pluginLabelKey: string;
  icon: string;
  tools: AgentToolConfig[];
}

// What an admin opens this page to audit: a tool that is on, may change data,
// and does it without asking. It is also the one fact that has to be legible
// from a section that is NOT open, so it rides the picker as a badge (#265).
export function autoRunCount(group: AgentToolGroup): number {
  return group.tools.filter(
    (tool) =>
      tool.isEnabled &&
      tool.confirmationPolicy === 'AUTO' &&
      tool.permission !== 'READ',
  ).length;
}
