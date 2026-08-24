import {
  AgentTool,
  PermissionLevel,
  isPictureAttachment,
  withPlugin,
} from '@makekeeper/plugin-contract';
import {
  AgentRegistryService,
  AttachmentStorageService,
  PluginI18nService,
} from '@makekeeper/backend-core';
import { attachmentIdFromRef, attachmentRef } from './attachment-ref';
import { ProviderService } from './providers.service';
import { AttachmentSettingsService } from './attachment-settings.service';

// Capabilities layer for the chat plugin. Only a non-sensitive READ of provider
// metadata is exposed — secret API keys are DELIBERATELY stripped before return
// so the product's AI agent can never read them (§5.7, §10).
export const getChatTools = (
  providerService: ProviderService,
  agentRegistry: AgentRegistryService,
  attachments: AttachmentStorageService,
  attachmentSettings: AttachmentSettingsService,
  i18n: PluginI18nService,
): AgentTool[] =>
  withPlugin('chat', 'plugins.chat.name', [
    {
      name: 'list_ai_providers',
      descriptionKey: 'chat.agentTools.list_ai_providers.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const providers = await providerService.findAll();
        return providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          provider: provider.provider,
          baseUrl: provider.baseUrl,
          modelName: provider.modelName,
          isDefault: provider.isDefault,
        }));
      },
    },

    // The uniform "what is this ORef and where does it live" lookup: the agent
    // hands back any canonical reference it received (page context, another tool's
    // `ref` output) and gets the object's name + breadcrumb, resolved server-side
    // by the owning plugin (issue #16). Ownership is enforced by the registry.
    {
      name: 'resolve_object_ref',
      descriptionKey: 'chat.agentTools.resolve_object_ref.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            descriptionKey: 'chat.agentTools.resolve_object_ref.params.ref',
          },
        },
        required: ['ref'],
      },
      handler: async (args: { ref: string }) => {
        const refString = String(args.ref);
        return (
          (await agentRegistry.resolveObjectRef(refString)) ?? {
            ref: refString,
            exists: false,
            displayName: '',
          }
        );
      },
    },

    // Reads an attachment's text on demand (#112). Deliberately pull-based: a
    // non-image attachment is announced in the turn, and only a model that
    // actually needs the content pays for it.
    //
    // Access is the existing one, not a second model: `Attachment` is scoped
    // (binding 'user'), the handler runs inside the request context, so another
    // user's row reads back as missing — exactly as on /api/uploads/:id.
    {
      name: 'read_attachment',
      descriptionKey: 'chat.agentTools.read_attachment.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            descriptionKey: 'chat.agentTools.read_attachment.params.ref',
          },
          offset: {
            type: 'number',
            descriptionKey: 'chat.agentTools.read_attachment.params.offset',
          },
        },
        required: ['ref'],
      },
      handler: async (args) => {
        const id = attachmentIdFromRef(String(args.ref ?? ''));
        if (!id) {
          return { error: i18n.t('chat.agentTools.read_attachment.notFound') };
        }
        const meta = await attachments.findMetaById(id);
        if (!meta) {
          return { error: i18n.t('chat.agentTools.read_attachment.notFound') };
        }

        const identity = {
          ref: attachmentRef(meta.id),
          filename: meta.filename,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
        };

        // A picture is served to vision as pixels, not to this tool as text —
        // saying so plainly beats handing back a page of mojibake.
        if (isPictureAttachment(meta)) {
          return {
            ...identity,
            content: null,
            note: i18n.t('chat.agentTools.read_attachment.isImage'),
          };
        }

        const { maxReadBytes } = await attachmentSettings.resolveEffective();
        const offset = Math.max(0, Math.trunc(Number(args.offset ?? 0) || 0));
        const window = await attachments.readTextWindow(
          meta.id,
          offset,
          maxReadBytes,
        );
        if (!window) {
          return { error: i18n.t('chat.agentTools.read_attachment.notFound') };
        }
        if (window.text === null) {
          return {
            ...identity,
            content: null,
            note: i18n.t('chat.agentTools.read_attachment.notText'),
          };
        }

        const end = offset + window.bytesRead;
        const truncated = end < window.sizeBytes;
        return {
          ...identity,
          offset,
          bytesRead: window.bytesRead,
          content: window.text,
          truncated,
          // Where a follow-up call should resume; absent once the file is done.
          ...(truncated ? { nextOffset: end } : {}),
        };
      },
    },
  ]);
