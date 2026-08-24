import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  AdminOnly,
  PluginOwner,
  Public,
  RequestHeadersLike,
  generateUuid,
} from '@makekeeper/backend-core';
import {
  CreatePhoneBridgeSessionResponse,
  PhoneBridgeMessage,
  PhoneBridgeResultsResponse,
  PhoneBridgeSessionInfo,
  PhoneBridgeSettingsPublic,
  TunnelStatus,
} from '@makekeeper/plugin-contract';
import { PhoneBridgeService } from './phone-bridge.service';
import { PhoneBridgeSettingsService } from './phone-bridge-settings.service';
import { CfTunnelService } from './cf-tunnel.service';
import {
  CreateSessionDto,
  RelayMessageDto,
  RetargetSessionDto,
  UpdatePhoneBridgeSettingsDto,
} from './phone-bridge.dto';
import {
  OwnerRequestLike,
  SetCookieResponseLike,
  buildOwnerSetCookie,
  isSecureRequest,
  readOwnerId,
} from './owner-cookie';

// The bridge request carries both the headers backend-core needs to resolve the
// public base URL and the cookie/proto bits the owner binding reads.
type BridgeRequest = RequestHeadersLike & OwnerRequestLike;

// All routes are gated by the plugin's enable/disable state (@PluginOwner).
@PluginOwner('phone-bridge')
@Controller('phone-bridge')
@ApiTags('phone-bridge')
@ApiBearerAuth()
@ApiOAuth2([])
export class PhoneBridgeController {
  constructor(
    private readonly bridge: PhoneBridgeService,
    private readonly settings: PhoneBridgeSettingsService,
    private readonly tunnel: CfTunnelService,
  ) {}

  // --- Bridge sessions ---

  @Post('sessions')
  createSession(
    @Body() body: CreateSessionDto,
    @Req() req: BridgeRequest,
    @Res({ passthrough: true }) res: SetCookieResponseLike,
  ): Promise<CreatePhoneBridgeSessionResponse> {
    // Bind the session to the calling desktop: reuse its owner cookie or mint a
    // new one (and hand it back) so only this browser can read the results.
    let ownerId = readOwnerId(req);
    if (!ownerId) {
      ownerId = generateUuid();
      res.setHeader(
        'Set-Cookie',
        buildOwnerSetCookie(ownerId, isSecureRequest(req)),
      );
    }
    return this.bridge.createSession(body.context, req, ownerId, body.origin);
  }

  // Token routes stay reachable without a multiuser login: they are called from
  // the paired phone, which authenticates by the unguessable session token, not
  // by a user account.
  @Public()
  @Get('sessions/:token')
  getSession(@Param('token') token: string): Promise<PhoneBridgeSessionInfo> {
    return this.bridge.getSessionInfo(token);
  }

  @Public()
  @Post('sessions/:token/messages')
  relayMessage(
    @Param('token') token: string,
    @Body() body: RelayMessageDto,
  ): Promise<PhoneBridgeMessage | null> {
    return this.bridge.relayMessage(token, body.payload);
  }

  // Re-point a live session at a new context (#79) — desktop-only, like results.
  @Patch('sessions/:token/context')
  retargetSession(
    @Param('token') token: string,
    @Body() body: RetargetSessionDto,
    @Req() req: BridgeRequest,
  ): Promise<PhoneBridgeSessionInfo> {
    return this.bridge.retargetSession(token, readOwnerId(req), {
      contextLabel: body.contextLabel,
      data: body.data,
    });
  }

  @Get('sessions/:token/results')
  getResults(
    @Param('token') token: string,
    @Req() req: BridgeRequest,
    @Query('since') since?: string,
  ): Promise<PhoneBridgeResultsResponse> {
    // Only the desktop that created the session may read its messages back.
    return this.bridge.getResults(token, readOwnerId(req), since);
  }

  @Public()
  @Post('sessions/:token/close')
  closeSession(@Param('token') token: string): Promise<{ token: string }> {
    return this.bridge.closeSession(token);
  }

  // --- Settings + Cloudflare tunnel (settings panel) ---

  @AdminOnly()
  @Get('settings')
  getSettings(): Promise<PhoneBridgeSettingsPublic> {
    return this.settings.get();
  }

  @AdminOnly()
  @Patch('settings')
  async updateSettings(
    @Body() body: UpdatePhoneBridgeSettingsDto,
  ): Promise<PhoneBridgeSettingsPublic> {
    const next = await this.settings.update({
      tunnelMode: body.tunnelMode,
      // An explicit empty string clears the override.
      cloudflaredPath:
        body.cloudflaredPath === undefined
          ? undefined
          : body.cloudflaredPath.trim() || null,
      tunnelIdleTtlMinutes: body.tunnelIdleTtlMinutes,
    });
    await this.tunnel.applyMode(next.tunnelMode);
    return next;
  }

  @AdminOnly()
  @Get('tunnel')
  getTunnel(): Promise<TunnelStatus> {
    return this.tunnel.getStatus();
  }

  @AdminOnly()
  @Post('tunnel/start')
  startTunnel(): Promise<TunnelStatus> {
    return this.tunnel.startManual();
  }

  @AdminOnly()
  @Post('tunnel/stop')
  stopTunnel(): Promise<TunnelStatus> {
    return this.tunnel.stopManual();
  }

  @AdminOnly()
  @Post('tunnel/download')
  downloadBinary(): Promise<TunnelStatus> {
    return this.tunnel.downloadBinary();
  }

  @AdminOnly()
  @Post('tunnel/delete')
  deleteBinary(): Promise<TunnelStatus> {
    return this.tunnel.deleteBinary();
  }
}
