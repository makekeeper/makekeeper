import {
  AttachmentStorageService,
  ExchangeSectionProvider,
  PrismaService,
  isExchangeRecord,
  readNumber,
  readOptionalString,
  readString,
} from '@makekeeper/backend-core';

// Instance-backup section of the capture plugin (#62): every Attachment row
// with its binary payload (the uploads tree travels inside the archive's
// files/). Ids and storage paths are preserved verbatim — the fresh-instance
// precondition guarantees no collisions — but bytes are re-staged through the
// canonical writer so the uploads root of the TARGET instance is the one that
// grows. (Tunnel settings moved to the phone-bridge plugin's backup, #77.)

export function createCaptureExchangeProviders(
  prisma: PrismaService,
  attachments: AttachmentStorageService,
): ExchangeSectionProvider[] {
  const attachmentsProvider: ExchangeSectionProvider = {
    sectionKey: 'capture.attachments',

    async exportSection(ctx) {
      const records: Record<string, unknown>[] = [];
      const rows = await prisma.attachment.findMany();
      for (const att of rows) {
        const file = await attachments.resolveExistingFile(att.id);
        // A row whose file vanished still travels — it keeps its references
        // (chat messages) intact; there are just no bytes to restore.
        if (file) await ctx.files.putFileFromPath(att.id, file.path);
        records.push({
          t: 'attachment',
          id: att.id,
          projectId: att.projectId,
          sessionId: att.sessionId,
          bridgeSessionId: att.bridgeSessionId,
          mimeType: att.mimeType,
          filename: att.filename,
          sizeBytes: att.sizeBytes,
          scopeId: att.scopeId,
          createdAt: att.createdAt.toISOString(),
          hasBytes: file !== null,
        });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'attachment')).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (isExchangeRecord(raw, 'attachment')) {
          const id = readString(raw, 'id', 100);
          const mimeType =
            readString(raw, 'mimeType', 100) ?? 'application/octet-stream';
          if (!id) continue;
          const src = await ctx.files.filePath(id);
          const filename = readOptionalString(raw, 'filename', 300);
          // Files kernel-copy into the target's uploads layout; a byteless
          // row keeps a dead path on purpose (matches its source state).
          const imported = src
            ? await attachments.importFileFromPath(id, mimeType, filename, src)
            : null;
          await ctx.tx.attachment.create({
            data: {
              id,
              ownerPluginId: 'capture',
              projectId: readOptionalString(raw, 'projectId', 100),
              sessionId: readOptionalString(raw, 'sessionId', 100),
              bridgeSessionId: null,
              storagePath: imported?.relPath ?? 'imported/missing',
              mimeType,
              filename,
              sizeBytes:
                imported?.sizeBytes ?? readNumber(raw, 'sizeBytes') ?? 0,
              // Previews are regenerated on import, not carried in the archive
              // (#113). A byteless row stays undecided rather than claiming to
              // be a picture it cannot produce.
              isImage: imported?.isImage ?? null,
              ...(imported?.previews ?? {}),
              scopeId: readOptionalString(raw, 'scopeId', 100),
            },
          });
          created += 1;
        }
      }
      return { created };
    },

    async countExistingRows(tx) {
      return tx.attachment.count();
    },
  };

  return [attachmentsProvider];
}
