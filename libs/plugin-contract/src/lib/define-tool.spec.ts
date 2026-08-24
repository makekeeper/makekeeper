import { PermissionLevel } from './agent-types';
import { defineTools, ToolDef } from './define-tool';

const defs: ToolDef[] = [
  {
    name: 'list_components',
    permission: PermissionLevel.READ,
    params: { query: { type: 'string', optional: true } },
    handler: async () => [],
  },
  {
    name: 'reserve_component',
    permission: PermissionLevel.WRITE,
    params: {
      projectId: { type: 'string' },
      componentId: { type: 'string' },
      qty: { type: 'number' },
      tags: { type: 'array', optional: true, items: { type: 'string' } },
      unit: { type: 'string', optional: true, enum: ['pcs', 'kg'] },
    },
    confirmSummary: () => ({ key: 'agentConfirm.reserve_component' }),
    handler: async () => ({ ok: true }),
  },
];

describe('defineTools', () => {
  const tools = defineTools('inventory.agentTools', defs);

  it('derives the tool description key from the namespace + name', () => {
    expect(tools[0].descriptionKey).toBe(
      'inventory.agentTools.list_components.description',
    );
  });

  it('derives each parameter description key from the JSON tree position', () => {
    expect(tools[1].parameters.properties.projectId.descriptionKey).toBe(
      'inventory.agentTools.reserve_component.params.projectId',
    );
    expect(tools[1].parameters.properties.tags.items?.descriptionKey).toBe(
      'inventory.agentTools.reserve_component.params.tags.items',
    );
  });

  it('derives `required` from the optional flag, preserving order', () => {
    expect(tools[1].parameters.required).toEqual([
      'projectId',
      'componentId',
      'qty',
    ]);
    expect(tools[0].parameters.required).toEqual([]);
  });

  it('passes enum and array item types through', () => {
    expect(tools[1].parameters.properties.unit.enum).toEqual(['pcs', 'kg']);
    expect(tools[1].parameters.properties.tags.items?.type).toBe('string');
  });

  it('keeps the handler, permission and confirmSummary', async () => {
    expect(tools[1].permission).toBe(PermissionLevel.WRITE);
    expect(await tools[1].handler({})).toEqual({ ok: true });
    expect(tools[1].confirmSummary).toBeDefined();
  });
});
