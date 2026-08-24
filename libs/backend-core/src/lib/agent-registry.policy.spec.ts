import { AgentRegistryService } from './agent-registry.service';
import type { PrismaService } from './prisma.service';
import type { PluginConfigService } from './plugin-config.service';
import {
  PermissionLevel,
  type AgentTool,
  type ToolArgs,
} from '@makekeeper/plugin-contract';

// Focused coverage of the default confirmation policy seeded on first tool
// registration (#78): every mutating tool (WRITE + DESTRUCTIVE) defaults to
// CONFIRM so the end user gates any data change; only READ auto-runs. Existing
// rows are never rewritten.
describe('AgentRegistryService confirmation-policy seeding', () => {
  const tool = (name: string, permission: PermissionLevel): AgentTool => ({
    name,
    descriptionKey: 'x',
    parameters: { type: 'object', properties: {} },
    permission,
    pluginId: 'p',
    pluginLabelKey: 'plugins.p.name',
    handler: async (_args: ToolArgs) => null,
    // Mutating tools ship a confirmSummary (asserted at bootstrap); provide a
    // stub so the startup guard stays quiet.
    confirmSummary: () => ({ key: 'k' }),
  });

  const buildWith = (
    tools: AgentTool[],
    existing: (name: string) => unknown | null,
  ): { service: AgentRegistryService; created: Record<string, string> } => {
    const created: Record<string, string> = {};
    const prisma = {
      agentToolConfig: {
        findUnique: async ({ where }: { where: { toolName: string } }) =>
          existing(where.toolName),
        create: async ({
          data,
        }: {
          data: { toolName: string; confirmationPolicy: string };
        }) => {
          created[data.toolName] = data.confirmationPolicy;
          return data;
        },
      },
    } as unknown as PrismaService;
    const service = new AgentRegistryService(prisma, {
      isEnabled: () => true,
    } as unknown as PluginConfigService);
    service.registerTools(tools);
    return { service, created };
  };

  it('seeds CONFIRM for WRITE and DESTRUCTIVE, AUTO for READ', async () => {
    const { service, created } = buildWith(
      [
        tool('read_it', PermissionLevel.READ),
        tool('write_it', PermissionLevel.WRITE),
        tool('nuke_it', PermissionLevel.DESTRUCTIVE),
      ],
      () => null,
    );
    await service.onApplicationBootstrap();
    expect(created).toEqual({
      read_it: 'AUTO',
      write_it: 'CONFIRM',
      nuke_it: 'CONFIRM',
    });
  });

  it('never rewrites an existing tool config (admin overrides survive)', async () => {
    const { service, created } = buildWith(
      [tool('write_it', PermissionLevel.WRITE)],
      () => ({ toolName: 'write_it', confirmationPolicy: 'AUTO' }),
    );
    await service.onApplicationBootstrap();
    expect(created).toEqual({});
  });
});
