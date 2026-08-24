import { NotFoundException } from '@nestjs/common';
import {
  AttachmentStorageService,
  ExchangeSectionProvider,
  PrismaService,
  generateUuid,
  isExchangeRecord,
  readBoolean,
  readDate,
  readOptionalString,
  readString,
  exchangeScopeStamp,
} from '@makekeeper/backend-core';
import { resolveEntityId } from '@makekeeper/plugin-contract';

// Exchange section provider of the chat plugin (#62): `chat.sessions` for the
// project root — AI chat sessions with their messages and message-image
// attachments (binaries travel in the section's files/). Usage telemetry
// (AIUsageEvent) is accounting data and deliberately does not travel with an
// entity export. On import, `/api/uploads/:id` URLs inside messages are
// rewritten to the newly created attachment ids.

const UPLOAD_URL_PREFIX = '/api/uploads/';

function mapId(
  ctx: {
    preserveIds: boolean;
    idMap: { translate(t: string, id: string | null): string | null };
  },
  entityType: string,
  oldId: string | null,
): string | null {
  if (!oldId) return null;
  return ctx.preserveIds ? oldId : ctx.idMap.translate(entityType, oldId);
}

export function createChatExchangeProviders(
  prisma: PrismaService,
  attachments: AttachmentStorageService,
): ExchangeSectionProvider[] {
  const sessionsProvider: ExchangeSectionProvider = {
    sectionKey: 'chat.sessions',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'projects',
            entityType: 'project',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      // Every conversation with at least one turn of this project (#130), and
      // each one WHOLE. A chat now crosses projects the way its user does, so
      // an export could carry only the turns stamped with the root — a decision
      // deliberately not taken: a conversation cut along a project boundary
      // imports as an answer whose question is missing. The cost is stated
      // plainly instead: exporting a project hands over any chat that touched
      // it, including what was said there about another project.
      const sessions = await prisma.aIChatSession.findMany({
        where: { messages: { some: { projectId: resolved.id } } },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      });
      const records: Record<string, unknown>[] = [];
      for (const session of sessions) {
        records.push({
          t: 'session',
          id: session.id,
          title: session.title,
          pinned: session.pinned,
          createdAt: session.createdAt.toISOString(),
        });
        for (const message of session.messages) {
          records.push({
            t: 'message',
            id: message.id,
            sessionId: message.sessionId,
            projectId: message.projectId,
            role: message.role,
            content: message.content,
            imageData: message.imageData,
            createdAt: message.createdAt.toISOString(),
          });
        }
        const sessionAttachments = await prisma.attachment.findMany({
          where: { sessionId: session.id },
        });
        for (const att of sessionAttachments) {
          const file = await attachments.resolveExistingFile(att.id);
          if (!file) continue;
          await ctx.files.putFileFromPath(att.id, file.path);
          records.push({
            t: 'attachment',
            id: att.id,
            sessionId: att.sessionId,
            projectId: att.projectId,
            mimeType: att.mimeType,
            filename: att.filename,
            sizeBytes: att.sizeBytes,
          });
        }
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'session')).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'session')) continue;
        const oldId = readString(raw, 'id', 100);
        if (!oldId) continue;
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('session', oldId, newId);
        await ctx.tx.aIChatSession.create({
          data: {
            id: newId,
            title: readOptionalString(raw, 'title', 500),
            pinned: readBoolean(raw, 'pinned', false),
            createdAt: readDate(raw, 'createdAt') ?? new Date(),
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      // Attachments before messages: message image URLs point at the NEW ids.
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'attachment')) continue;
        const oldId = readString(raw, 'id', 100);
        const sessionId = mapId(
          ctx,
          'session',
          readOptionalString(raw, 'sessionId', 100),
        );
        if (!oldId || !sessionId) continue;
        const src = await ctx.files.filePath(oldId);
        if (!src) continue;
        const mimeType =
          readString(raw, 'mimeType', 100) ?? 'application/octet-stream';
        const filename = readOptionalString(raw, 'filename', 300);
        const newId = ctx.preserveIds ? oldId : 'att_' + generateUuid();
        ctx.idMap.set('attachment', oldId, newId);
        const imported = await attachments.importFileFromPath(
          newId,
          mimeType,
          filename,
          src,
        );
        await ctx.tx.attachment.create({
          data: {
            id: newId,
            ownerPluginId: 'chat',
            sessionId,
            projectId: mapId(
              ctx,
              'project',
              readOptionalString(raw, 'projectId', 100),
            ),
            storagePath: imported.relPath,
            mimeType,
            filename,
            sizeBytes: imported.sizeBytes,
            // Previews are regenerated on import, not carried in the archive
            // (#113) — a derivative is a cache, not data.
            isImage: imported.isImage,
            ...imported.previews,
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'message')) continue;
        const sessionId = mapId(
          ctx,
          'session',
          readString(raw, 'sessionId', 100),
        );
        const role = readString(raw, 'role', 20);
        const content = raw['content'];
        if (!sessionId || !role || typeof content !== 'string') continue;
        // Rewrite upload URLs to the imported attachment ids; an image whose
        // attachment did not make it degrades to no image.
        let imageData = readOptionalString(raw, 'imageData', 1000);
        if (imageData?.startsWith(UPLOAD_URL_PREFIX)) {
          const mapped = mapId(
            ctx,
            'attachment',
            imageData.slice(UPLOAD_URL_PREFIX.length),
          );
          imageData = mapped ? `${UPLOAD_URL_PREFIX}${mapped}` : null;
        }
        await ctx.tx.aIChatMessage.create({
          data: {
            id: ctx.preserveIds
              ? (readString(raw, 'id', 100) ?? generateUuid())
              : generateUuid(),
            sessionId,
            // The turn's own scope (#130). A message from an archive written
            // before the stamp existed carries none, and a project that did not
            // travel with it maps to none — either way the turn imports as
            // project-less rather than claiming a project of the target
            // instance it never belonged to.
            projectId: mapId(
              ctx,
              'project',
              readOptionalString(raw, 'projectId', 100),
            ),
            role,
            content,
            imageData,
            createdAt: readDate(raw, 'createdAt') ?? new Date(),
          },
        });
        created += 1;
      }
      return { created };
    },
  };

  return [sessionsProvider];
}
