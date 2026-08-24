import { ExternalPermissionsService } from './external-permissions.service';
import { AgentTool, PermissionLevel } from '@makekeeper/plugin-contract';
import type { AgentRegistryService } from '@makekeeper/backend-core';

const tool = (
  name: string,
  pluginId: string,
  permission: PermissionLevel,
): AgentTool => ({
  name,
  descriptionKey: `${pluginId}.tools.${name}`,
  parameters: { type: 'object', properties: {} },
  permission,
  pluginId,
  pluginLabelKey: `plugins.${pluginId}.name`,
  handler: async () => null,
});

const TOOLS = [
  tool('list_components', 'inventory', PermissionLevel.READ),
  tool('create_component', 'inventory', PermissionLevel.WRITE),
  tool('delete_component', 'inventory', PermissionLevel.DESTRUCTIVE),
  tool('list_orders', 'logistics', PermissionLevel.READ),
];

describe('ExternalPermissionsService (scoped-surface matrix)', () => {
  const registry = {
    getTools: () => TOOLS,
    getEnabledTools: () => TOOLS,
    getEnabledTool: (name: string) => TOOLS.find((t) => t.name === name),
  } as unknown as AgentRegistryService;
  const permissions = new ExternalPermissionsService(registry);

  it('allows a READ tool under a read grant for its owning plugin', () => {
    expect(
      permissions.decide('list_components', ['inventory:read']).allowed,
    ).toBe(true);
  });

  it('refuses a WRITE tool under a read-only grant', () => {
    const decision = permissions.decide('create_component', ['inventory:read']);
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe('forbidden');
  });

  it('treats a write grant as implying read on the same plugin', () => {
    expect(
      permissions.decide('list_components', ['inventory:write']).allowed,
    ).toBe(true);
    expect(
      permissions.decide('create_component', ['inventory:write']).allowed,
    ).toBe(true);
  });

  it('gates a DESTRUCTIVE tool on the explicit destructive class (#252)', () => {
    // Write grants, however broad, never delete.
    for (const grants of [
      ['inventory:write'],
      ['inventory:read', 'inventory:write'],
      ['instance:inventory:read', 'inventory:write'],
    ]) {
      const decision = permissions.decide('delete_component', grants);
      expect(decision.allowed).toBe(false);
      if (decision.allowed === false) {
        expect(decision.reason).toBe('destructive');
      }
    }
    expect(
      permissions.decide('delete_component', ['inventory:destructive']).allowed,
    ).toBe(true);
  });

  it('treats destructive as implying write and read on the same plugin', () => {
    for (const tool of [
      'list_components',
      'create_component',
      'delete_component',
    ]) {
      expect(permissions.decide(tool, ['inventory:destructive']).allowed).toBe(
        true,
      );
    }
    // …but never on another plugin.
    expect(
      permissions.decide('list_orders', ['inventory:destructive']).allowed,
    ).toBe(false);
  });

  it("does not let a grant for one plugin reach another plugin's tools", () => {
    expect(permissions.decide('list_orders', ['inventory:write']).allowed).toBe(
      false,
    );
  });

  it('does not let an instance grant reach record-level operations', () => {
    // The instance surface is aggregates-only: its grant class must never
    // satisfy the scoped matrix.
    expect(
      permissions.decide('list_components', ['instance:inventory:read'])
        .allowed,
    ).toBe(false);
  });

  it('enumerates exactly the callable tools for discovery', () => {
    expect(
      permissions.callableTools(['inventory:write']).map((t) => t.name),
    ).toEqual(['list_components', 'create_component']);
  });

  it('lists instance-readable plugins from instance grants only', () => {
    expect(
      permissions.instanceReadablePlugins([
        'inventory:read',
        'instance:logistics:read',
        'capability:chat.vision-completion',
      ]),
    ).toEqual(['logistics']);
  });

  it('reports an unknown operation distinctly from a denied one', () => {
    const decision = permissions.decide('nope', ['inventory:write']);
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false)
      expect(decision.reason).toBe('unknown-tool');
  });

  // Connection tokens (#249): no grants — the ceiling clamps the level, and
  // the tool universe is every enabled plugin's tools.
  describe('ceiling clamp (connection tokens, #249)', () => {
    it('allows READ everywhere under a read-only ceiling', () => {
      expect(
        permissions.decideForCeiling('list_components', 'read-only').allowed,
      ).toBe(true);
      expect(
        permissions.decideForCeiling('list_orders', 'read-only').allowed,
      ).toBe(true);
    });

    it('refuses WRITE under a read-only ceiling', () => {
      const decision = permissions.decideForCeiling(
        'create_component',
        'read-only',
      );
      expect(decision.allowed).toBe(false);
      if (decision.allowed === false) expect(decision.reason).toBe('forbidden');
    });

    it('allows WRITE under a read-write ceiling', () => {
      expect(
        permissions.decideForCeiling('create_component', 'read-write').allowed,
      ).toBe(true);
    });

    it('reaches DESTRUCTIVE only under the destructive ceiling (#252)', () => {
      expect(
        permissions.decideForCeiling('delete_component', 'destructive').allowed,
      ).toBe(true);
      for (const ceiling of ['read-only', 'read-write'] as const) {
        const decision = permissions.decideForCeiling(
          'delete_component',
          ceiling,
        );
        expect(decision.allowed).toBe(false);
        if (decision.allowed === false) {
          expect(decision.reason).toBe('destructive');
        }
      }
    });

    it('enumerates callable tools for a ceiling across all plugins', () => {
      expect(
        permissions.callableToolsForCeiling('read-only').map((t) => t.name),
      ).toEqual(['list_components', 'list_orders']);
      expect(
        permissions.callableToolsForCeiling('read-write').map((t) => t.name),
      ).toEqual(['list_components', 'create_component', 'list_orders']);
      expect(
        permissions.callableToolsForCeiling('destructive').map((t) => t.name),
      ).toEqual([
        'list_components',
        'create_component',
        'delete_component',
        'list_orders',
      ]);
    });
  });
});
