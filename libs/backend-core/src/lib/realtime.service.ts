import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  DATA_CHANGED_EVENT,
  DataChangedRealtimePayload,
  RealtimeAck,
  RealtimeRequestContext,
  realtimeRoomPrefix,
  scopeRoom,
} from '@makekeeper/plugin-contract';
import { PluginConfigService } from './plugin-config.service';
import { RequestContextService } from './request-context.service';

// Decides whether a client may join a room of the registering plugin's prefix.
// `userId` is null while the multiuser overlay is off (single-user mode).
export type RealtimeRoomAuthorizer = (
  userId: string | null,
  room: string,
) => boolean | Promise<boolean>;

// Handles an inbound socket command. Runs with `ctx` already established as the
// ambient request context (scope/locale), so its Prisma calls scope exactly
// like an HTTP request's. Returns the WS ack (accepted / refused).
export type RealtimeCommandHandler = (
  ctx: RealtimeRequestContext,
  data: unknown,
) => Promise<RealtimeAck>;

interface RegisteredAuthorizer {
  pluginId: string;
  authorize: RealtimeRoomAuthorizer;
}

interface RegisteredCommand {
  pluginId: string;
  handle: RealtimeCommandHandler;
}

// The realtime seam plugins talk to (#61) — mirrors the other backend-core
// registries: plugins never touch the gateway or socket.io directly, they
// register a room authorizer for their prefix in `onModuleInit()` and emit
// through `emitToRoom`. Emitting is fire-and-forget and a no-op before the
// gateway attaches, so realtime is strictly additive: every consumer keeps
// working when no client ever connects.
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;
  private readonly authorizers = new Map<string, RegisteredAuthorizer>();
  private readonly commands = new Map<string, RegisteredCommand>();

  constructor(
    private readonly pluginConfig: PluginConfigService,
    private readonly requestContext: RequestContextService,
  ) {}

  // Called once by RealtimeGateway.afterInit — the only socket.io touchpoint.
  attachServer(server: Server): void {
    this.server = server;
  }

  registerRoomAuthorizer(
    pluginId: string,
    roomPrefix: string,
    authorize: RealtimeRoomAuthorizer,
  ): void {
    if (this.authorizers.has(roomPrefix)) {
      this.logger.warn(
        `Room prefix "${roomPrefix}" already registered — overwriting (plugin "${pluginId}")`,
      );
    }
    this.authorizers.set(roomPrefix, { pluginId, authorize });
  }

  // A room is joinable only when its prefix has a registered authorizer, the
  // owning plugin is enabled, and the authorizer approves — so disabling a
  // plugin removes its realtime surface exactly like its routes and tools.
  async authorizeRoom(userId: string | null, room: string): Promise<boolean> {
    const entry = this.authorizers.get(realtimeRoomPrefix(room));
    if (!entry) return false;
    if (!this.pluginConfig.isEnabled(entry.pluginId)) return false;
    return entry.authorize(userId, room);
  }

  // A plugin registers one handler per client→server command it accepts. The
  // gateway is the only caller of `dispatchCommand`; plugins never see socket.io.
  registerCommand(
    pluginId: string,
    command: string,
    handle: RealtimeCommandHandler,
  ): void {
    if (this.commands.has(command)) {
      this.logger.warn(
        `Command "${command}" already registered — overwriting (plugin "${pluginId}")`,
      );
    }
    this.commands.set(command, { pluginId, handle });
  }

  // Dispatch an inbound command to its handler, honoring plugin-enable state
  // (a disabled plugin's command vanishes exactly like its routes). Returns
  // null when no enabled handler exists, so the gateway can ack a clear error.
  async dispatchCommand(
    command: string,
    ctx: RealtimeRequestContext,
    data: unknown,
  ): Promise<RealtimeAck | null> {
    const entry = this.commands.get(command);
    if (!entry) return null;
    if (!this.pluginConfig.isEnabled(entry.pluginId)) return null;
    return entry.handle(ctx, data);
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }

  // Data-changed nudge for the caller's scope: scoped emit under multiuser
  // (scope id from the ambient request context), broadcast in single-user
  // mode where every connected client shares the one data set.
  emitDataChanged(pluginIds: string[]): void {
    this.emitDataChangedForScope(
      pluginIds,
      this.requestContext.get()?.scopeId ?? null,
    );
  }

  // Same nudge for an EXPLICIT scope, used where the target is not the ambient
  // request context — an external plugin's invalidation call (#136), whose
  // scope comes from its token, and background work acting for one scope.
  // Passing null broadcasts, which is correct in single-user mode.
  emitDataChangedForScope(
    pluginIds: string[],
    scopeId: string | null,
    opts?: { screensOnly?: boolean },
  ): void {
    if (!this.server || pluginIds.length === 0) return;
    const payload: DataChangedRealtimePayload = {
      pluginIds,
      ...(opts?.screensOnly ? { screensOnly: true } : {}),
    };
    if (scopeId) {
      this.server.to(scopeRoom(scopeId)).emit(DATA_CHANGED_EVENT, payload);
    } else {
      this.server.emit(DATA_CHANGED_EVENT, payload);
    }
  }
}
