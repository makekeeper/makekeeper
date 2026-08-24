import {
  AgentTool,
  PermissionLevel,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { CodesService } from './codes.service';

// Agent tools for the codes plugin (#74). Text is i18n `descriptionKey` (§5.5);
// WRITE/DESTRUCTIVE tools carry a human-readable `confirmSummary` (§5.7). Handlers
// receive no request, so a label's deep-link falls back to PUBLIC_BASE_URL.
const NO_REQ = { headers: {} };

export const getCodesTools = (codes: CodesService): AgentTool[] =>
  withPlugin('codes', 'plugins.codes.name', [
    {
      name: 'resolve_code',
      descriptionKey: 'codes.agentTools.resolve_code.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          value: {
            type: 'string',
            descriptionKey: 'codes.agentTools.resolve_code.params.value',
          },
        },
        required: ['value'],
      },
      handler: async (args) => {
        const resolved = await codes.describeScan(String(args.value));
        return resolved
          ? { found: true, ...resolved }
          : { found: false, value: String(args.value) };
      },
    },
    {
      name: 'create_label',
      descriptionKey: 'codes.agentTools.create_label.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            descriptionKey: 'codes.agentTools.create_label.params.ref',
          },
        },
        required: ['ref'],
      },
      confirmSummary: async (args) => {
        const info = await codes.describeScan(String(args.ref));
        return {
          key: 'codes.agentConfirm.create_label',
          params: { name: info?.displayName || String(args.ref) },
        };
      },
      handler: (args) => codes.ensureLabel(String(args.ref), NO_REQ),
    },
    {
      name: 'delete_label',
      descriptionKey: 'codes.agentTools.delete_label.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            descriptionKey: 'codes.agentTools.delete_label.params.code',
          },
        },
        required: ['code'],
      },
      confirmSummary: async (args) => {
        const info = await codes.describeScan(String(args.code));
        return {
          key: 'codes.agentConfirm.delete_label',
          params: {
            code: String(args.code),
            name: info?.displayName || String(args.code),
          },
        };
      },
      handler: async (args) => {
        const deleted = await codes.deleteByCodeOrRef(String(args.code));
        return { deleted };
      },
    },
  ]);
