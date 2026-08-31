import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Allow, IsString, MaxLength } from 'class-validator';
import {
  REALTIME_AUTH_CAPABILITY,
  REALTIME_GUEST_AUTH_CAPABILITY,
  REALTIME_COMMAND_MESSAGE,
  REALTIME_PATH,
  REALTIME_SUBSCRIBE_MESSAGE,
  REALTIME_UNSUBSCRIBE_MESSAGE,
  RealtimeAck,
  RealtimeAuthCapability,
  RealtimeGuestAuthCapability,
  RealtimeRequestContext,
  scopeRoom,
  userRoom,
} from '@makekeeper/plugin-contract';
import { CapabilityRegistryService } from './capability-registry.service';
import { PluginI18nService } from './plugin-i18n.service';
import { RealtimeService } from './realtime.service';
import { RequestContextService } from './request-context.service';
import { getErrorMessage } from './error';

export class RealtimeSubscribeDto {
  @IsString()
  @MaxLength(200)
  room!: string;
}

export class RealtimeCommandDto {
  @IsString()
  @MaxLength(100)
  command!: string;

  // Payload shape is per-command; the handling plugin validates it. Kept
  // untyped here so the generic gateway stays plugin-agnostic. `@Allow()` keeps
  // the ValidationPipe's `whitelist` from stripping this undecorated property.
  @Allow()
  data!: unknown;
}

// What the gateway stows on an authenticated socket. All fields stay null in
// single-user mode (no multiuser capability registered).
interface RealtimeSocketData {
  userId: string | null;
  scopeId: string | null;
  locale: string | null;
  // IANA zone of the caller's clock. A socket has no headers, so it arrives in
  // the handshake beside the language.
  timezone: string | null;
  // The ONLY room a guest socket (a paired phone — capability token, no user
  // account) may be in. Null for a normal socket. See RealtimeGuestAuthCapability.
  guestRoom?: string | null;
}

const socketData = (client: Socket): RealtimeSocketData => {
  const data: unknown = client.data;
  const record =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  return {
    userId: typeof record['userId'] === 'string' ? record['userId'] : null,
    scopeId: typeof record['scopeId'] === 'string' ? record['scopeId'] : null,
    locale: typeof record['locale'] === 'string' ? record['locale'] : null,
    timezone:
      typeof record['timezone'] === 'string' ? record['timezone'] : null,
    guestRoom:
      typeof record['guestRoom'] === 'string' ? record['guestRoom'] : null,
  };
};

// A zone name the runtime knows, or nothing at all.
const knownTimezone = (value: string | null): string | null => {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return null;
  }
};

const authField = (client: Socket, key: string): string | null => {
  const auth: unknown = client.handshake.auth;
  if (typeof auth !== 'object' || auth === null) return null;
  const value = (auth as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

// The single socket.io gateway (#61). Lives in backend-core so plugins never
// depend on socket.io: they emit via RealtimeService and gate joins via room
// authorizers. Path sits under /api so the existing nginx `/api/` proxy
// forwards the upgrade without new routing.
//
// Handshake auth mirrors MultiuserGuard: while the multiuser plugin is enabled
// it registers RealtimeAuthCapability and every connection must carry a valid
// JWT in `handshake.auth.token` (browsers cannot set WS headers); the scope in
// `handshake.auth.scopeId` is honored only when a grant allows it. Without the
// capability (overlay off/disabled) connections are anonymous pass-through —
// exactly the guard's single-user behavior.
// maxHttpBufferSize matches the HTTP body limit (main.ts / nginx 64m) so a
// chat message carrying a base64 image is accepted over the socket too.
@WebSocketGateway({ path: REALTIME_PATH, maxHttpBufferSize: 64 * 1024 * 1024 })
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly requestContext: RequestContextService,
  ) {}

  // A guest credential names at most one room; without the capability (the
  // issuing plugin disabled) there are no guests at all.
  private async resolveGuestRoom(client: Socket): Promise<string | null> {
    const credential = authField(client, 'guestToken');
    if (!credential) return null;
    const guestAuth =
      this.capabilities.getCapability<RealtimeGuestAuthCapability>(
        REALTIME_GUEST_AUTH_CAPABILITY,
      );
    return guestAuth ? guestAuth.resolveGuestRoom(credential) : null;
  }

  afterInit(server: Server): void {
    this.realtime.attachServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const locale = authField(client, 'locale');
      // Validated here rather than where a date is computed: the handshake is
      // client data, and an unknown zone must fail at the door, not inside a
      // calculation far from it.
      const timezone = knownTimezone(authField(client, 'timezone'));
      client.data = {
        userId: null,
        scopeId: null,
        locale,
        timezone,
      } satisfies RealtimeSocketData;

      const auth = this.capabilities.getCapability<RealtimeAuthCapability>(
        REALTIME_AUTH_CAPABILITY,
      );
      if (!auth) return;

      const token = authField(client, 'token');
      const userId = token ? await auth.verifyToken(token) : null;
      if (!userId) {
        // No user token: the connection may still be a GUEST device holding a
        // capability token (a paired phone). It gets that one room and nothing
        // else — no user room, no scope room, no commands.
        const guestRoom = await this.resolveGuestRoom(client);
        if (!guestRoom) {
          client.disconnect(true);
          return;
        }
        client.data = {
          userId: null,
          scopeId: null,
          locale,
          timezone,
          guestRoom,
        } satisfies RealtimeSocketData;
        await client.join(guestRoom);
        return;
      }

      const requestedScope = authField(client, 'scopeId') ?? userId;
      const scopeId =
        requestedScope === userId ||
        (await auth.canAccessScope(userId, requestedScope))
          ? requestedScope
          : userId;
      client.data = {
        userId,
        scopeId,
        locale,
        timezone,
      } satisfies RealtimeSocketData;
      await client.join(userRoom(userId));
      await client.join(scopeRoom(scopeId));
    } catch (err) {
      this.logger.warn(`Realtime handshake failed: ${getErrorMessage(err)}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage(REALTIME_COMMAND_MESSAGE)
  async onCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: RealtimeCommandDto,
  ): Promise<RealtimeAck> {
    const { userId, scopeId, locale, timezone, guestRoom } = socketData(client);
    try {
      // A guest device is a listener, never an actor: it holds a capability
      // token for one room, not a user identity to act as.
      if (guestRoom) {
        return {
          error: this.i18n.t(
            'core.errors.realtimeGuestForbidden',
            undefined,
            locale ?? undefined,
          ),
        };
      }
      // Rebuild the caller's request context (scope/locale/effective plugins)
      // for the duration of the handler, so its Prisma calls scope exactly like
      // an HTTP request. Empty context in single-user mode (no auth capability).
      const auth = this.capabilities.getCapability<RealtimeAuthCapability>(
        REALTIME_AUTH_CAPABILITY,
      );
      let ctx: RealtimeRequestContext;
      if (auth && userId) {
        const resolved = await auth.resolveContext(
          userId,
          scopeId ?? undefined,
          locale ?? undefined,
        );
        if (!resolved) {
          return {
            error: this.i18n.t(
              'multiuser.errors.unauthorized',
              undefined,
              locale ?? undefined,
            ),
          };
        }
        // The overlay resolves who is calling; where they are is the socket's
        // to say, and it knows it whether or not the overlay is installed.
        ctx = { ...resolved, ...(timezone ? { timezone } : {}) };
      } else {
        ctx = {
          ...(locale ? { locale } : {}),
          ...(timezone ? { timezone } : {}),
        };
      }

      const ack = await this.requestContext.run(ctx, () =>
        this.realtime.dispatchCommand(dto.command, ctx, dto.data),
      );
      if (ack === null) {
        return {
          error: this.i18n.t(
            'core.errors.realtimeCommandUnknown',
            { command: dto.command },
            locale ?? undefined,
          ),
        };
      }
      return ack;
    } catch (err) {
      return { error: getErrorMessage(err) };
    }
  }

  @SubscribeMessage(REALTIME_SUBSCRIBE_MESSAGE)
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: RealtimeSubscribeDto,
  ): Promise<RealtimeAck> {
    try {
      const { userId, locale, guestRoom } = socketData(client);
      // Guests are pinned to the single room their credential named.
      const allowed = guestRoom
        ? dto.room === guestRoom
        : await this.realtime.authorizeRoom(userId, dto.room);
      if (!allowed) {
        return {
          error: this.i18n.t(
            'core.errors.realtimeRoomDenied',
            undefined,
            locale ?? undefined,
          ),
        };
      }
      await client.join(dto.room);
      return { ok: true };
    } catch (err) {
      return { error: getErrorMessage(err) };
    }
  }

  @SubscribeMessage(REALTIME_UNSUBSCRIBE_MESSAGE)
  async onUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: RealtimeSubscribeDto,
  ): Promise<RealtimeAck> {
    try {
      await client.leave(dto.room);
      return { ok: true };
    } catch (err) {
      return { error: getErrorMessage(err) };
    }
  }
}
