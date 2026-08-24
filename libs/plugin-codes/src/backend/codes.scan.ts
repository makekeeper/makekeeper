import { Injectable, Logger } from '@nestjs/common';
import {
  PhoneBridgeKindContext,
  PhoneBridgeKindHandler,
  PhoneBridgeMessage,
} from '@makekeeper/plugin-contract';

// Scan is a consumer of the generic phone-bridge (#77): codes registers this
// handler for the `scan` kind and the bridge invokes it. Unlike capture, a scan
// carries no durable artifact — the phone relays a decoded string and the
// desktop consumes it immediately — so this is a pure in-memory relay keyed by
// the bridge token, dropped when the bridge GCs the session. The desktop reads
// the decoded values back through the bridge's cursor-paged poll.

interface ScanPayload {
  value: string;
  // Key of the host action the user confirmed on the phone (#79). Absent for the
  // global scan, which has no context and simply navigates.
  action?: string;
}

const isScanPayload = (payload: unknown): payload is ScanPayload =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as { value?: unknown }).value === 'string' &&
  (payload as ScanPayload).value.trim().length > 0 &&
  (typeof (payload as { action?: unknown }).action === 'string' ||
    (payload as { action?: unknown }).action === undefined);

interface ScanBuffer {
  seq: number;
  messages: PhoneBridgeMessage[];
}

@Injectable()
export class ScanRelayService implements PhoneBridgeKindHandler {
  private readonly logger = new Logger(ScanRelayService.name);
  // token → the decoded values relayed so far this session. A monotonic `seq`
  // (not a timestamp) is the cursor, so two scans in the same millisecond can't
  // shadow each other on the desktop poll.
  private readonly buffers = new Map<string, ScanBuffer>();

  async onMessage(
    ctx: PhoneBridgeKindContext,
    payload: unknown,
  ): Promise<PhoneBridgeMessage | null> {
    if (!isScanPayload(payload)) return null;
    const value = payload.value.trim();
    const buf = this.buffers.get(ctx.token) ?? { seq: 0, messages: [] };
    buf.seq += 1;
    const message: PhoneBridgeMessage = {
      id: String(buf.seq),
      createdAt: new Date().toISOString(),
      data: { value, action: payload.action },
    };
    buf.messages.push(message);
    this.buffers.set(ctx.token, buf);
    this.logger.debug(`Scan relayed for ${ctx.token}: ${value}`);
    return message;
  }

  async readResults(
    token: string,
    since: string | undefined,
  ): Promise<{ messages: PhoneBridgeMessage[]; cursor: string }> {
    const buf = this.buffers.get(token);
    if (!buf) return { messages: [], cursor: since ?? '0' };
    const sinceSeq = since ? Number(since) : 0;
    const messages = buf.messages.filter(
      (m) => Number(m.id) > (Number.isNaN(sinceSeq) ? 0 : sinceSeq),
    );
    const cursor = messages.length
      ? messages[messages.length - 1].id
      : (since ?? String(buf.seq));
    return { messages, cursor };
  }

  async onGarbageCollect(token: string): Promise<void> {
    this.buffers.delete(token);
  }
}
