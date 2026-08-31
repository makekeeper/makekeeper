import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Public,
  PluginOwner,
  RequestContextService,
} from '@makekeeper/backend-core';
import type {
  NotificationView,
  NotifyInboxChangedPayload,
  NotifyPreferences,
} from '@makekeeper/plugin-contract';
import { NotifyService } from './notify.service';
import {
  NotifyPreferencesDto,
  PushSubscribeDto,
  SetChannelEnabledDto,
  SetNotificationRoutesDto,
  SnoozeNotificationDto,
} from './notify.dto';
import { NotifyDeliveryService } from './delivery.service';
import {
  NotifyActionsService,
  type ActionOutcome,
} from './notify-actions.service';
import { WebPushService } from './web-push.service';

// The inbox is read through its owner's own request context; @PluginOwner makes
// every route 404 while notify is disabled, so the bell disappears with the
// plugin exactly like any other surface.
@PluginOwner('notify')
@Controller('notifications')
@ApiTags('notifications')
@ApiBearerAuth()
@ApiOAuth2([])
export class NotifyController {
  constructor(
    private readonly notify: NotifyService,
    private readonly context: RequestContextService,
    private readonly delivery: NotifyDeliveryService,
    private readonly actions: NotifyActionsService,
    private readonly webPush: WebPushService,
  ) {}

  // ── Channels and routing (#311) ───────────────────────────────────────────

  @Get('channels')
  @ApiOperation({ summary: 'i18n:notify.api.channels' })
  async channels(): Promise<
    {
      channelId: string;
      labelKey: string;
      linked: boolean;
      enabled: boolean;
      external: boolean;
    }[]
  > {
    const scopeId = this.context.get()?.scopeId ?? null;
    return Promise.all(
      this.delivery.channels().map(async (channel) => ({
        channelId: channel.impl.channelId,
        labelKey: channel.impl.labelKey,
        // Connected: the person has given it something to reach them with.
        linked: await channel.impl.isLinked(scopeId),
        // In use: their own master switch, which is a different question.
        enabled: await this.notify.channelEnabled(
          scopeId,
          channel.impl.channelId,
        ),
        // A channel offered by an installed container rather than by the app.
        external: channel.pluginId !== 'notify',
      })),
    );
  }

  @Post('channels/:channelId/enabled')
  @ApiOperation({ summary: 'i18n:notify.api.setChannelEnabled' })
  async setChannelEnabled(
    @Param('channelId') channelId: string,
    @Body() dto: SetChannelEnabledDto,
  ): Promise<{ ok: true }> {
    await this.notify.setChannelEnabled(channelId, dto.enabled);
    return { ok: true };
  }

  @Get('types')
  @ApiOperation({ summary: 'i18n:notify.api.types' })
  types(): { type: string; labelKey: string; pluginId: string }[] {
    return this.notify.listDeclarations().map((declaration) => ({
      type: declaration.type,
      labelKey: declaration.labelKey,
      pluginId: declaration.pluginId,
    }));
  }

  @Get('routes')
  @ApiOperation({ summary: 'i18n:notify.api.routes' })
  routes(): Promise<{ type: string; channelId: string; enabled: boolean }[]> {
    return this.notify.listRoutes();
  }

  // One request per DECISION, not per cell: "everything of this plugin, off"
  // is one thing a person did, and a request per cell would let it land half
  // applied and leave the screen disagreeing with the server.
  @Post('routes')
  @ApiOperation({ summary: 'i18n:notify.api.setRoute' })
  async setRoutes(
    @Body() dto: SetNotificationRoutesDto,
  ): Promise<{ ok: true }> {
    await this.notify.setRoutes(dto.types, dto.channelIds, dto.enabled);
    return { ok: true };
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'i18n:notify.api.deliveries' })
  deliveries(): Promise<
    {
      id: string;
      channelId: string;
      attempts: number;
      deliveredAt: string | null;
      deadAt: string | null;
      lastError: string | null;
    }[]
  > {
    return this.notify.listDeliveries();
  }

  // The press of a button that arrived in a chat client or a phone banner. No
  // session reaches this route — the single-use token IS the authority, and it
  // authorises exactly one act (#311).
  @Public()
  @Post('action/:token')
  @ApiOperation({ summary: 'i18n:notify.api.action' })
  redeem(@Param('token') token: string): Promise<ActionOutcome> {
    return this.actions.redeem(token);
  }

  // ── Web push ──────────────────────────────────────────────────────────────

  @Get('push/key')
  @ApiOperation({ summary: 'i18n:notify.api.pushKey' })
  async pushKey(): Promise<{ publicKey: string }> {
    return { publicKey: await this.webPush.publicKey() };
  }

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'i18n:notify.api.pushList' })
  pushSubscriptions(): Promise<
    {
      id: string;
      label: string | null;
      createdAt: string;
      fingerprint: string;
    }[]
  > {
    return this.webPush.listForCaller();
  }

  @Post('push/subscriptions')
  @ApiOperation({ summary: 'i18n:notify.api.pushSubscribe' })
  async pushSubscribe(@Body() dto: PushSubscribeDto): Promise<{ ok: true }> {
    await this.webPush.subscribe(dto);
    return { ok: true };
  }

  @Delete('push/subscriptions/:id')
  @ApiOperation({ summary: 'i18n:notify.api.pushRemove' })
  async pushRemove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.webPush.removeById(id);
    return { ok: true };
  }

  @Get()
  @ApiOperation({ summary: 'i18n:notify.api.list' })
  list(
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
  ): Promise<NotificationView[]> {
    const parsed = Number(limit);
    const take = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 100)
      : 30;
    return this.notify.list(take, unread === 'true');
  }

  @Get('counts')
  @ApiOperation({ summary: 'i18n:notify.api.counts' })
  counts(): Promise<NotifyInboxChangedPayload> {
    return this.notify.unreadCounts(this.context.get()?.scopeId ?? null);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'i18n:notify.api.markRead' })
  async markRead(@Param('id') id: string): Promise<{ ok: true }> {
    await this.notify.markRead(id);
    return { ok: true };
  }

  @Post(':id/snooze')
  @ApiOperation({ summary: 'i18n:notify.api.snooze' })
  async snooze(
    @Param('id') id: string,
    @Body() dto: SnoozeNotificationDto,
  ): Promise<{ ok: boolean }> {
    return { ok: await this.notify.snooze(id, dto.minutes) };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'i18n:notify.api.markAllRead' })
  async markAllRead(): Promise<{ ok: true }> {
    await this.notify.markAllRead();
    return { ok: true };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'i18n:notify.api.remove' })
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.notify.remove(id);
    return { ok: true };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'i18n:notify.api.preferences' })
  preferences(): Promise<NotifyPreferences> {
    return this.notify.getPreferences();
  }

  @Put('preferences')
  @ApiOperation({ summary: 'i18n:notify.api.setPreferences' })
  setPreferences(
    @Body() dto: NotifyPreferencesDto,
  ): Promise<NotifyPreferences> {
    return this.notify.setPreferences({
      quietFromMinutes: dto.quietFromMinutes ?? null,
      quietToMinutes: dto.quietToMinutes ?? null,
      timezone: dto.timezone ?? null,
      locale: dto.locale ?? null,
    });
  }
}
