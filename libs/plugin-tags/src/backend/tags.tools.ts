import {
  AgentTool,
  PermissionLevel,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { PluginI18nService } from '@makekeeper/backend-core';
import { TAG_COLORS } from '../tag-colors';
import { TagsService } from './tags.service';

// Capabilities layer for the tags plugin (#60). READ tools query the vocabulary
// and the objects behind a tag; WRITE tools manage the vocabulary and attach it
// to objects (a `ref` param is any object's canonical ORef); the single
// DESTRUCTIVE tool removes a tag everywhere and is gated by the runtime's
// human-in-the-loop confirmation. All descriptions are i18n keys.
export const getTagsTools = (
  tags: TagsService,
  i18n: PluginI18nService,
): AgentTool[] =>
  withPlugin('tags', 'plugins.tags.name', [
    // ── READ ────────────────────────────────────────────────────────────────

    {
      name: 'list_tags',
      descriptionKey: 'tags.agentTools.list_tags.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            descriptionKey: 'tags.agentTools.list_tags.params.query',
          },
        },
        required: [],
      },
      handler: async (args) =>
        tags.listTags(
          args.query === undefined ? undefined : String(args.query),
        ),
    },

    {
      name: 'get_object_tags',
      descriptionKey: 'tags.agentTools.get_object_tags.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            descriptionKey: 'tags.agentTools.get_object_tags.params.ref',
          },
        },
        required: ['ref'],
      },
      handler: async (args) => tags.tagsForRef(String(args.ref)),
    },

    {
      name: 'find_objects_by_tag',
      descriptionKey: 'tags.agentTools.find_objects_by_tag.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            descriptionKey: 'tags.agentTools.find_objects_by_tag.params.tag',
          },
        },
        required: ['tag'],
      },
      handler: async (args) => {
        // An unknown tag throws (i18n-keyed, like the sibling tools) — an empty
        // array is reserved for "tag exists but is unused".
        const tag = await tags.requireTag(String(args.tag));
        return tags.objectsForTag(tag.id);
      },
    },

    // ── WRITE ───────────────────────────────────────────────────────────────

    {
      name: 'create_tag',
      descriptionKey: 'tags.agentTools.create_tag.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            descriptionKey: 'tags.agentTools.create_tag.params.name',
          },
          color: {
            type: 'string',
            enum: [...TAG_COLORS],
            descriptionKey: 'tags.agentTools.create_tag.params.color',
          },
        },
        required: ['name'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.create_tag',
        params: { name: String(args.name) },
      }),
      handler: async (args) =>
        tags.createTag({
          name: String(args.name),
          color: args.color === undefined ? undefined : String(args.color),
        }),
    },

    {
      name: 'update_tag',
      descriptionKey: 'tags.agentTools.update_tag.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            descriptionKey: 'tags.agentTools.update_tag.params.tag',
          },
          name: {
            type: 'string',
            descriptionKey: 'tags.agentTools.update_tag.params.name',
          },
          color: {
            type: 'string',
            enum: [...TAG_COLORS],
            descriptionKey: 'tags.agentTools.update_tag.params.color',
          },
        },
        required: ['tag'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.update_tag',
        params: { name: await tags.resolveTagName(String(args.tag)) },
      }),
      handler: async (args) => {
        const tag = await tags.requireTag(String(args.tag));
        return tags.updateTag(tag.id, {
          name: args.name === undefined ? undefined : String(args.name),
          color: args.color === undefined ? undefined : String(args.color),
        });
      },
    },

    {
      name: 'assign_tag',
      descriptionKey: 'tags.agentTools.assign_tag.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            descriptionKey: 'tags.agentTools.assign_tag.params.tag',
          },
          ref: {
            type: 'string',
            descriptionKey: 'tags.agentTools.assign_tag.params.ref',
          },
        },
        required: ['tag', 'ref'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.assign_tag',
        params: {
          tag: await tags.resolveTagName(String(args.tag)),
          ref: String(args.ref),
        },
      }),
      handler: async (args) => tags.assign(String(args.tag), String(args.ref)),
    },

    {
      name: 'unassign_tag',
      descriptionKey: 'tags.agentTools.unassign_tag.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            descriptionKey: 'tags.agentTools.unassign_tag.params.tag',
          },
          ref: {
            type: 'string',
            descriptionKey: 'tags.agentTools.unassign_tag.params.ref',
          },
        },
        required: ['tag', 'ref'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.unassign_tag',
        params: {
          tag: await tags.resolveTagName(String(args.tag)),
          ref: String(args.ref),
        },
      }),
      handler: async (args) => {
        const tag = await tags.findTag(String(args.tag));
        if (tag) await tags.unassign(tag.id, String(args.ref));
        return { ok: true };
      },
    },

    // ── DESTRUCTIVE ───────────────────────────────────────────────────────────

    {
      name: 'delete_tag',
      descriptionKey: 'tags.agentTools.delete_tag.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            descriptionKey: 'tags.agentTools.delete_tag.params.tag',
          },
        },
        required: ['tag'],
      },
      confirmSummary: async (args) => ({
        key: 'agentConfirm.delete_tag',
        params: { name: await tags.resolveTagName(String(args.tag)) },
      }),
      handler: async (args) => {
        const tag = await tags.requireTag(String(args.tag));
        await tags.deleteTag(tag.id);
        return { ok: true };
      },
    },
  ]);
