import {
  AgentTool,
  PermissionLevel,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { CfTunnelService } from './cf-tunnel.service';

// Capabilities layer for the phone-bridge plugin (#77). Phone pairing is a
// user-driven flow (the end user scans a QR), so no WRITE/DESTRUCTIVE tools are
// exposed to the agent — only a READ of the public-tunnel availability, so the
// agent can tell whether a phone can currently reach the app over HTTPS.
export const getPhoneBridgeTools = (tunnel: CfTunnelService): AgentTool[] =>
  withPlugin('phone-bridge', 'plugins.phone-bridge.name', [
    {
      name: 'get_phone_bridge_status',
      descriptionKey:
        'phoneBridge.agentTools.get_phone_bridge_status.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const status = await tunnel.getStatus();
        return {
          mode: status.mode,
          state: status.state,
          url: status.url ?? null,
          binaryPresent: status.binaryPresent,
        };
      },
    },
  ]);
