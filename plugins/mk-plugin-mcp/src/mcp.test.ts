import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authOf, toMcpTool } from './mcp.ts';
import type { CoreOperation } from './core-api.ts';

const op = (permission: CoreOperation['permission']): CoreOperation => ({
  name: 'list_components',
  pluginId: 'inventory',
  permission,
  description: 'Lists inventory items',
  resolvedParameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search text' } },
  },
});

test('annotations derive from the core permission level', () => {
  assert.deepEqual(toMcpTool(op('READ')).annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(toMcpTool(op('WRITE')).annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(toMcpTool(op('DESTRUCTIVE')).annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  });
});

test('the resolved schema passes through as the MCP inputSchema', () => {
  const tool = toMcpTool(op('READ'));
  assert.equal(tool.name, 'list_components');
  assert.equal(tool.description, 'Lists inventory items');
  assert.equal(tool.inputSchema.type, 'object');
  assert.ok('query' in tool.inputSchema.properties);
});

test('authOf reads the delivering request, tolerating absence and arrays', () => {
  assert.equal(authOf({}), undefined);
  assert.equal(
    authOf({ requestInfo: { headers: { authorization: 'Bearer mkt_x' } } }),
    'Bearer mkt_x',
  );
  assert.equal(
    authOf({ requestInfo: { headers: { authorization: ['Bearer a', 'b'] } } }),
    'Bearer a',
  );
});
