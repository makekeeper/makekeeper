import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  AttachmentStorageService,
} from '@makekeeper/backend-core';
import {
  PhoneBridgeKindContext,
  PhoneBridgeKindHandler,
  PhoneBridgeMessage,
} from '@makekeeper/plugin-contract';

// Capture is now a consumer of the generic phone-bridge (#77): it registers this
// handler for the `capture` kind, and the bridge invokes it. The phone relays a
// downscaled photo data URL; the handler stores it as an Attachment owned by the
// bridge session (so bridge TTL GC can drop unclaimed photos), and the desktop
// polls the saved photos back through the bridge. Session/token/QR/tunnel/route
// all belong to the bridge — capture owns only the photo payload.

interface ImagePayload {
  image: string;
}

const isImagePayload = (payload: unknown): payload is ImagePayload =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as { image?: unknown }).image === 'string';

@Injectable()
export class CaptureService implements PhoneBridgeKindHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
  ) {}

  // Phone relayed one frame: persist it, stamped for the session's owning user
  // so the desktop's scoped read can see it (no-op stamp when the overlay is
  // off). Returns the saved photo as the message the phone echoes as a thumbnail.
  async onMessage(
    ctx: PhoneBridgeKindContext,
    payload: unknown,
  ): Promise<PhoneBridgeMessage | null> {
    if (!isImagePayload(payload)) return null;
    const url = await this.storage.saveDataUrl(
      { pluginId: 'capture', bridgeSessionId: ctx.token },
      payload.image,
      ctx.scopeOwnerId,
    );
    if (!url) return null;
    const att = await this.storage.findByUrl(url);
    return {
      id: att?.id ?? '',
      createdAt: (att?.createdAt ?? new Date()).toISOString(),
      data: { url },
    };
  }

  // Desktop poll: photos newer than the cursor, as bridge messages carrying the
  // public "/api/uploads/:id" URL.
  async readResults(
    token: string,
    since: string | undefined,
  ): Promise<{ messages: PhoneBridgeMessage[]; cursor: string }> {
    const sinceDate = since ? new Date(since) : null;
    const rows = await this.prisma.attachment.findMany({
      where: {
        bridgeSessionId: token,
        ...(sinceDate && !Number.isNaN(sinceDate.getTime())
          ? { createdAt: { gt: sinceDate } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const messages: PhoneBridgeMessage[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      data: { url: `/api/uploads/${r.id}` },
    }));
    const cursor = messages.length
      ? messages[messages.length - 1].createdAt
      : (since ?? '');
    return { messages, cursor };
  }

  // Bridge GC'd a dead session: drop its unclaimed photos. Claimed photos were
  // re-owned into their target (cleared bridgeSessionId) and are left untouched.
  async onGarbageCollect(token: string): Promise<void> {
    await this.storage.deleteByBridgeSession(token);
  }
}
