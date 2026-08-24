import { describe, expect, it, vi } from 'vitest';
import { PermissionLevel } from '@makekeeper/plugin-contract';
import { SettingsService } from './settings.service';
import type {
  AgentRegistryService,
  PluginRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';

// The rule under test (#137, decision #7): an EXTERNAL mutating tool's
// confirmation gate can never be relaxed to auto-run. An internal tool's AUTO
// setting rests on its code having passed review — a third-party container has
// no such basis — so both the projection the settings UI reads and the write
// path must refuse it, independently of what the UI offers.

const tool = (over: {
  name: string;
  permission: PermissionLevel;
  external?: boolean;
}) => ({
  name: over.name,
  descriptionKey: `${over.name}.desc`,
  permission: over.permission,
  parameters: { type: 'object' as const, properties: {} },
  pluginId: over.external ? 'weather' : 'inventory',
  pluginLabelKey: 'plugins.x.name',
  external: over.external,
  handler: async () => null,
});

const makeService = (
  tools: ReturnType<typeof tool>[],
  rows: Array<{
    toolName: string;
    isEnabled: boolean;
    confirmationPolicy: string;
  }>,
) => {
  const upsert = vi.fn(async (args: unknown) => args);
  const prisma = {
    agentToolConfig: {
      findMany: async () => rows,
      upsert,
    },
  } as unknown as PrismaService;
  const agentRegistry = {
    getGroupedTools: () => [
      { pluginId: 'x', pluginLabelKey: 'plugins.x.name', tools },
    ],
    getTool: (name: string) => tools.find((t) => t.name === name),
  } as unknown as AgentRegistryService;
  const pluginRegistry = {
    getPlugin: () => ({ icon: 'Box' }),
  } as unknown as PluginRegistryService;
  return {
    service: new SettingsService(prisma, agentRegistry, pluginRegistry),
    upsert,
  };
};

describe('external agent-tool confirmation gate', () => {
  it('reports an external WRITE tool as gated even when a stored row says AUTO', async () => {
    const { service } = makeService(
      [
        tool({
          name: 'weather__set_alert',
          permission: PermissionLevel.WRITE,
          external: true,
        }),
      ],
      [
        {
          toolName: 'weather__set_alert',
          isEnabled: true,
          confirmationPolicy: 'AUTO',
        },
      ],
    );
    const groups = await service.getAgentTools();
    const projected = groups[0].tools[0];
    expect(projected.confirmationPolicy).toBe('CONFIRM');
    expect(projected.external).toBe(true);
  });

  it('leaves an external READ tool alone (gating every read would train users to click through)', async () => {
    const { service } = makeService(
      [
        tool({
          name: 'weather__forecast',
          permission: PermissionLevel.READ,
          external: true,
        }),
      ],
      [],
    );
    const groups = await service.getAgentTools();
    expect(groups[0].tools[0].confirmationPolicy).toBe('AUTO');
  });

  it('still honours a stored AUTO for an INTERNAL write tool', async () => {
    const { service } = makeService(
      [tool({ name: 'create_component', permission: PermissionLevel.WRITE })],
      [
        {
          toolName: 'create_component',
          isEnabled: true,
          confirmationPolicy: 'AUTO',
        },
      ],
    );
    const groups = await service.getAgentTools();
    expect(groups[0].tools[0].confirmationPolicy).toBe('AUTO');
    expect(groups[0].tools[0].external).toBe(false);
  });

  it('refuses to STORE auto-run for an external write tool, not just to display it', async () => {
    const { service, upsert } = makeService(
      [
        tool({
          name: 'weather__set_alert',
          permission: PermissionLevel.WRITE,
          external: true,
        }),
      ],
      [],
    );
    await service.updateAgentTool('weather__set_alert', {
      confirmationPolicy: 'AUTO',
    });
    const args = upsert.mock.calls[0][0] as {
      create: { confirmationPolicy: string };
      update: { confirmationPolicy?: string };
    };
    expect(args.create.confirmationPolicy).toBe('CONFIRM');
    expect(args.update.confirmationPolicy).toBe('CONFIRM');
  });

  it('lets an internal write tool be relaxed as before', async () => {
    const { service, upsert } = makeService(
      [tool({ name: 'create_component', permission: PermissionLevel.WRITE })],
      [],
    );
    await service.updateAgentTool('create_component', {
      confirmationPolicy: 'AUTO',
    });
    const args = upsert.mock.calls[0][0] as {
      create: { confirmationPolicy: string };
    };
    expect(args.create.confirmationPolicy).toBe('AUTO');
  });

  it('projects an INTERNAL destructive tool as CONFIRM even if a row says AUTO (#243)', async () => {
    const { service } = makeService(
      [
        tool({
          name: 'delete_component',
          permission: PermissionLevel.DESTRUCTIVE,
        }),
      ],
      [
        {
          toolName: 'delete_component',
          isEnabled: true,
          confirmationPolicy: 'AUTO',
        },
      ],
    );
    const groups = await service.getAgentTools();
    // The DB/projection must agree with the runtime gate, which always
    // confirms a destructive tool.
    expect(groups[0].tools[0].confirmationPolicy).toBe('CONFIRM');
  });

  it('refuses to STORE auto-run for an internal destructive tool (#243)', async () => {
    const { service, upsert } = makeService(
      [
        tool({
          name: 'delete_component',
          permission: PermissionLevel.DESTRUCTIVE,
        }),
      ],
      [],
    );
    await service.updateAgentTool('delete_component', {
      confirmationPolicy: 'AUTO',
    });
    const args = upsert.mock.calls[0][0] as {
      create: { confirmationPolicy: string };
      update: { confirmationPolicy?: string };
    };
    expect(args.create.confirmationPolicy).toBe('CONFIRM');
    expect(args.update.confirmationPolicy).toBe('CONFIRM');
  });
});
