import {
  Injectable,
  Logger,
  NotFoundException,
  GoneException,
  PayloadTooLargeException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  PrismaService,
  AppConfigService,
  CapabilityRegistryService,
  RealtimeService,
  RequestContextService,
  RequestHeadersLike,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  CreatePhoneBridgeSessionResponse,
  PHONE_BRIDGE_UPDATE_EVENT,
  PhoneBridgeContext,
  PhoneBridgeKindHandler,
  PhoneBridgeMessage,
  PhoneBridgeResultsResponse,
  PhoneBridgeSessionInfo,
  PhoneBridgeSessionStatus,
  phoneBridgeKindCapability,
  phoneBridgeRoom,
  realtimeRoomId,
  withLocaleParam,
} from '@makekeeper/plugin-contract';
import { CfTunnelService } from './cf-tunnel.service';
import { PhoneBridgeSettingsService } from './phone-bridge-settings.service';

// Generic phone-connection bridge session lifecycle (#77, generalized from the
// #6 capture flow): the desktop creates a session declaring a `kind` and gets a
// QR; the phone opens /d/<token>, the bridge shell renders the surface for that
// kind, and what the phone relays is dispatched to the consumer plugin's
// registered kind handler. Sessions are short-lived (TTL) and garbage-collected;
// the bridge owns transport, the consumer owns the payload.

const TTL_MS = 10 * 60 * 1000; // session lifetime from creation
const WARMUP_SECONDS = 10; // hold the QR this long while a fresh tunnel's DNS propagates
const GC_GRACE_MS = 5 * 60 * 1000; // keep dead sessions this long before GC
const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_CONTEXT_CHARS = 16 * 1024; // serialized session context (label + surface bootstrap data)
const ACTIVE_STATUSES: readonly PhoneBridgeSessionStatus[] = [
  'pending',
  'active',
];

@Injectable()
export class PhoneBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhoneBridgeService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly tunnel: CfTunnelService,
    private readonly requestContext: RequestContextService,
    private readonly realtime: RealtimeService,
    private readonly settings: PhoneBridgeSettingsService,
  ) {}

  // Resolve the consumer plugin's handler for a session's kind. Null when the
  // consumer is disabled/absent — the bridge then drops the relay, so disabling
  // the consumer removes exactly its surface.
  private handlerFor(kind: string): PhoneBridgeKindHandler | null {
    return this.capabilities.getCapability<PhoneBridgeKindHandler>(
      phoneBridgeKindCapability(kind),
    );
  }

  // Desktop joins `phone-bridge:<token>` to get nudges instead of tight polling.
  // Bound to the multiuser user who created the session (`scopeOwnerId` —
  // `ownerId` is the desktop *cookie* identity, which a WS handshake doesn't
  // carry); token knowledge alone suffices in single-user mode, where the token
  // is an unguessable capability — exactly the phone routes' model.
  async authorizeRealtimeRoom(
    userId: string | null,
    room: string,
  ): Promise<boolean> {
    const token = realtimeRoomId(room);
    if (!token) return false;
    const session = await this.prisma.phoneBridgeSession.findUnique({
      where: { token },
    });
    if (!session) return false;
    return session.scopeOwnerId === null || session.scopeOwnerId === userId;
  }

  // Guest realtime credential (#79): a bridge session token names exactly one
  // room — its own. The phone gets push for desktop-side changes (the session
  // was re-pointed at another cell, or ended) instead of polling for them.
  async resolveGuestRoom(credential: string): Promise<string | null> {
    return (await this.isActiveSession(credential))
      ? phoneBridgeRoom(credential)
      : null;
  }

  // Nudge, not a data carrier: the desktop reacts by re-polling /results with
  // its cursor, so push and fallback polling share one dedup path.
  private nudge(token: string): void {
    this.realtime.emitToRoom(
      phoneBridgeRoom(token),
      PHONE_BRIDGE_UPDATE_EVENT,
      {},
    );
  }

  onModuleInit(): void {
    // Periodic TTL expiry + dead-session GC + auto-tunnel idle stop.
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((err) =>
        this.logger.error(`Bridge sweep failed: ${getErrorMessage(err)}`),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async createSession(
    context: PhoneBridgeContext,
    req: RequestHeadersLike,
    ownerId: string | null,
    clientOrigin?: string,
  ): Promise<CreatePhoneBridgeSessionResponse> {
    const token = 'br_' + generateUuid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);
    // Reject an oversized context before anything else — no row, no tunnel.
    const serializedContext = this.serializeContext(context);

    // Remember which multiuser user owns this session so the phone (which relays
    // anonymously, outside any request scope) can stamp its writes for that
    // user's scoped reads. Null when the overlay is off.
    const rc = this.requestContext.get();
    const scopeOwnerId = rc?.userId ?? rc?.scopeId ?? null;

    await this.prisma.phoneBridgeSession.create({
      data: {
        token,
        kind: context.kind,
        context: serializedContext,
        status: 'pending',
        expiresAt,
        lastActivityAt: now,
        ownerId,
        scopeOwnerId,
      },
    });

    const { baseUrl, warmupSeconds, source } = await this.resolveBaseUrl(
      req,
      clientOrigin,
    );
    // The guest page opens in the language of the desktop that produced this QR
    // (#211): `apiFetch` puts the caller's locale on every request, and a phone
    // that has never met this instance has no other way of learning it.
    const url = withLocaleParam(
      `${baseUrl}/d/${token}`,
      firstHeader(req.headers['x-locale']),
    );
    this.logger.log(
      `Bridge session created (${context.kind}): ${url} (base from ${source}, warmup ${warmupSeconds}s)`,
    );

    return {
      token,
      url,
      expiresAt: expiresAt.toISOString(),
      warmupSeconds,
    };
  }

  // Decide the public base URL the phone-facing link is built on, and whether a
  // tunnel warm-up is needed. Precedence (docs/tls-public-access.md):
  //   1. PUBLIC_BASE_URL override — always wins.
  //   2. `on` mode — the operator insists on the managed tunnel.
  //   3. Already served over HTTPS (the desktop's own origin, else https
  //      forwarded headers) ⇒ in `auto` the tunnel is redundant, so skip it
  //      (#93). This is the fix for a front proxy that reset X-Forwarded-Proto.
  //   4. Otherwise `auto` spins the tunnel; `off` falls back to the header URL
  //      (preferring an existing HTTPS origin over a bare http one).
  private async resolveBaseUrl(
    req: RequestHeadersLike,
    clientOrigin?: string,
  ): Promise<{
    baseUrl: string;
    warmupSeconds: number;
    source: string;
  }> {
    const override = this.config.getPublicBaseUrlOverride();
    if (override) {
      return { baseUrl: override, warmupSeconds: 0, source: 'PUBLIC_BASE_URL' };
    }

    const mode = await this.settings.getMode();
    const existingHttps = this.config.pickSecurePublicOrigin(clientOrigin, req);
    const fromExistingHttps = (
      baseUrl: string,
    ): { baseUrl: string; warmupSeconds: number; source: string } => ({
      baseUrl,
      warmupSeconds: 0,
      source: 'existing HTTPS',
    });

    // Auto mode + we already reach the app over HTTPS ⇒ the tunnel adds nothing.
    if (mode === 'auto' && existingHttps) {
      return fromExistingHttps(existingHttps);
    }

    // `on` (always) or `auto` without existing HTTPS ⇒ use the managed tunnel.
    // A just-started tunnel needs a moment for its DNS to propagate; ask the
    // client to hold the QR briefly so the phone doesn't cache a failed lookup.
    const tunnel = await this.tunnel.ensureForCapture(); // `off` ⇒ null
    if (tunnel.url) {
      return {
        baseUrl: tunnel.url,
        warmupSeconds: tunnel.freshlyStarted ? WARMUP_SECONDS : 0,
        source: 'CF tunnel',
      };
    }

    // `off`, or the tunnel failed to start: prefer any existing HTTPS origin
    // over a bare header-derived http URL.
    if (existingHttps) {
      return fromExistingHttps(existingHttps);
    }
    return {
      baseUrl: this.config.resolvePublicBaseUrl(req),
      warmupSeconds: 0,
      source: 'request headers',
    };
  }

  // Capability surface (#74, PhoneBridgeSessionCapability): is this token a
  // currently-open session? Lets a consumer that exposes a phone-facing
  // `@Public()` endpoint (codes' scan preview) require the phone's bridge token
  // instead of accepting any anonymous caller, without learning anything about
  // the session beyond its liveness.
  async isActiveSession(token: string): Promise<boolean> {
    const session = await this.prisma.phoneBridgeSession.findUnique({
      where: { token },
    });
    if (!session) return false;
    const status = this.effectiveStatus(session.status, session.expiresAt);
    return status === 'active' || status === 'pending';
  }

  // Phone-side: validate a token and mark the session active on first open.
  async getSessionInfo(token: string): Promise<PhoneBridgeSessionInfo> {
    const session = await this.requireSession(token);
    const status = this.effectiveStatus(session.status, session.expiresAt);
    if (status === 'expired' || status === 'closed') {
      return {
        status,
        kind: session.kind,
        expiresAt: session.expiresAt.toISOString(),
        contextLabel: this.parseContext(session.context).contextLabel,
      };
    }
    if (session.status === 'pending') {
      await this.prisma.phoneBridgeSession.update({
        where: { token },
        data: { status: 'active', lastActivityAt: new Date() },
      });
      // The phone just opened the link — let the desktop hide the QR at once.
      this.nudge(token);
    }
    const context = this.parseContext(session.context);
    return {
      status: 'active',
      kind: session.kind,
      expiresAt: session.expiresAt.toISOString(),
      contextLabel: context.contextLabel,
      // Surface bootstrap data (#79) — relayed verbatim, never interpreted here.
      data: context.data,
    };
  }

  // Phone-side: relay one payload; the kind handler processes it and returns the
  // message the phone should echo back (a thumbnail ref, …), or null.
  async relayMessage(
    token: string,
    payload: unknown,
  ): Promise<PhoneBridgeMessage | null> {
    const session = await this.requireSession(token);
    const status = this.effectiveStatus(session.status, session.expiresAt);
    if (status !== 'active' && status !== 'pending') {
      throw new GoneException('bridge_session_closed');
    }

    const handler = this.handlerFor(session.kind);
    if (!handler) throw new GoneException('bridge_kind_unavailable');

    const message = await handler.onMessage(
      { token, scopeOwnerId: session.scopeOwnerId },
      payload,
    );

    await this.prisma.phoneBridgeSession.update({
      where: { token },
      data: { status: 'active', lastActivityAt: new Date() },
    });
    this.nudge(token);
    return message;
  }

  // Desktop-side: poll for messages newer than the cursor. Only the desktop that
  // created the session may read them (issue #10) — a mismatch is reported as
  // "not found" so a non-owner can't even confirm the session exists.
  async getResults(
    token: string,
    ownerId: string | null,
    since?: string,
  ): Promise<PhoneBridgeResultsResponse> {
    const session = await this.requireSession(token);
    this.assertDesktopOwner(session, ownerId);
    const status = this.effectiveStatus(session.status, session.expiresAt);
    const handler = this.handlerFor(session.kind);
    if (!handler) {
      return { status, messages: [], cursor: since ?? '' };
    }
    const { messages, cursor } = await handler.readResults(token, since);
    return { status, messages, cursor: cursor || (since ?? '') };
  }

  // Desktop-side ownership gate for reading results / retargeting. Two locks
  // (#243): with the multiuser overlay on the session is bound to the USER who
  // created it (`scopeOwnerId`) — an unguessable per-browser cookie is not an
  // identity, and must not be the only thing separating two logged-in users.
  // The cookie check stays as the single-user isolation and as defense in
  // depth. A mismatch reads as "not found" so a non-owner cannot even confirm
  // the session exists.
  private assertDesktopOwner(
    session: { ownerId: string | null; scopeOwnerId: string | null },
    ownerId: string | null,
  ): void {
    const callerUserId = this.requestContext.get()?.userId ?? null;
    if (
      session.scopeOwnerId !== null &&
      session.scopeOwnerId !== callerUserId
    ) {
      throw new NotFoundException('bridge_session_not_found');
    }
    if (session.ownerId !== null && session.ownerId !== ownerId) {
      throw new NotFoundException('bridge_session_not_found');
    }
  }

  // Re-point a LIVE session at a new context (#79) instead of closing it and
  // making the user re-pair: the phone is already in the user's hand, camera up.
  // Only the desktop that opened the session may do it, and only while it is
  // still usable — a closed session stays closed. The phone picks the change up
  // on its next session-info read and tells the user what it is now filing into.
  async retargetSession(
    token: string,
    ownerId: string | null,
    patch: { contextLabel?: string; data?: unknown },
  ): Promise<PhoneBridgeSessionInfo> {
    const session = await this.requireSession(token);
    this.assertDesktopOwner(session, ownerId);
    const status = this.effectiveStatus(session.status, session.expiresAt);
    if (status !== 'active' && status !== 'pending') {
      throw new GoneException('bridge_session_closed');
    }
    // `kind` is deliberately NOT patchable: it selects the phone's surface, and
    // swapping it under a mounted surface is a different feature (a multi-modal
    // session), not a retarget.
    const context: PhoneBridgeContext = this.parseContext(session.context);
    // A PATCH carries only what it means to change: an absent field leaves the
    // stored value alone rather than erasing it (both are optional in the DTO).
    if (patch.contextLabel !== undefined)
      context.contextLabel = patch.contextLabel;
    if (patch.data !== undefined) context.data = patch.data;
    const serialized = this.serializeContext(context);
    await this.prisma.phoneBridgeSession.update({
      where: { token },
      data: { context: serialized, lastActivityAt: new Date() },
    });
    this.nudge(token);
    return {
      // The session keeps whatever liveness it had — retargeting a session the
      // phone has not opened yet must not report it as paired.
      status,
      kind: session.kind,
      expiresAt: session.expiresAt.toISOString(),
      contextLabel: context.contextLabel,
      data: context.data,
    };
  }

  async closeSession(token: string): Promise<{ token: string }> {
    const now = new Date();
    await this.prisma.phoneBridgeSession
      .update({
        where: { token },
        // Completing the transfer expires the key immediately (issue #10):
        // expiring alongside closing kills every effectiveStatus check, so a
        // leaked token stops working the moment the phone taps "done".
        data: { status: 'closed', expiresAt: now, lastActivityAt: now },
      })
      .catch(() => undefined); // idempotent close
    this.nudge(token);
    return { token };
  }

  private async requireSession(token: string): Promise<{
    token: string;
    kind: string;
    context: string;
    status: string;
    expiresAt: Date;
    ownerId: string | null;
    scopeOwnerId: string | null;
  }> {
    const session = await this.prisma.phoneBridgeSession.findUnique({
      where: { token },
    });
    if (!session) throw new NotFoundException('bridge_session_not_found');
    return session;
  }

  private effectiveStatus(
    status: string,
    expiresAt: Date,
  ): PhoneBridgeSessionStatus {
    if (status === 'closed') return 'closed';
    if (expiresAt.getTime() < Date.now()) return 'expired';
    return status === 'active' ? 'active' : 'pending';
  }

  // The surface bootstrap `data` is opaque to the bridge, so class-validator
  // cannot bound it field by field — but it is a small descriptor (a label and a
  // handful of action stubs), not a payload. Bound the serialized context here,
  // far below the global 64 MB body cap, so neither create nor retarget can park
  // an arbitrary blob on a session row.
  private serializeContext(context: PhoneBridgeContext): string {
    const serialized = JSON.stringify(context);
    if (serialized.length > MAX_CONTEXT_CHARS) {
      throw new PayloadTooLargeException('bridge_context_too_large');
    }
    return serialized;
  }

  private parseContext(raw: string): PhoneBridgeContext {
    try {
      return JSON.parse(raw) as PhoneBridgeContext;
    } catch {
      return { kind: 'capture' };
    }
  }

  // TTL expiry, dead-session GC (delegating payload cleanup to the consumer's
  // kind handler), and auto-tunnel idle stop.
  private async sweep(): Promise<void> {
    const now = new Date();

    await this.prisma.phoneBridgeSession.updateMany({
      where: {
        status: { in: ACTIVE_STATUSES as PhoneBridgeSessionStatus[] },
        expiresAt: { lt: now },
      },
      data: { status: 'expired' },
    });

    const cutoff = new Date(now.getTime() - GC_GRACE_MS);
    const dead = await this.prisma.phoneBridgeSession.findMany({
      where: {
        status: { in: ['expired', 'closed'] },
        lastActivityAt: { lt: cutoff },
      },
      select: { token: true, kind: true },
    });
    for (const s of dead) {
      // The consumer drops any transient data it stored under the token; claimed
      // data was re-owned into its target and is left untouched.
      await this.handlerFor(s.kind)?.onGarbageCollect?.(s.token);
      await this.prisma.phoneBridgeSession
        .delete({ where: { token: s.token } })
        .catch(() => undefined);
    }

    const active = await this.prisma.phoneBridgeSession.count({
      where: {
        status: { in: ACTIVE_STATUSES as PhoneBridgeSessionStatus[] },
        expiresAt: { gte: now },
      },
    });
    await this.tunnel.stopIfIdle(active);
  }
}

// A header as Express hands it over: repeated headers arrive as an array, and
// only the first of them is an answer.
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
