import {
  AgentTool,
  PermissionLevel,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { SettingsService } from './settings.service';

// Capabilities layer for the settings plugin. Only non-sensitive READ methods
// are exposed. Agent-tool permission mutations are DELIBERATELY NOT exposed:
// letting the product's AI agent relax its own confirmation policies would be a
// privilege-escalation path. Those stay human-only (§5.7, §10). (AI provider
// listing lives in the chat plugin, which owns provider settings.)
export const getSettingsTools = (
  settingsService: SettingsService,
): AgentTool[] =>
  withPlugin('settings', 'plugins.settings.name', [
    // ── READ ──────────────────────────────────────────────────────────────────

    {
      name: 'list_agent_tools',
      descriptionKey: 'settings.agentTools.list_agent_tools.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => settingsService.getAgentTools(),
    },
  ]);
