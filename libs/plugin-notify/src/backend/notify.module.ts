import { Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import {
  AppConfigModule,
  CapabilityRegistryService,
  PluginEventBusService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
  RealtimeService,
  SecretBoxModule,
} from '@makekeeper/backend-core';
import {
  CORE_DEVICE_REVOKED_EVENT,
  NOTIFY_BUS_CAPABILITY,
  NOTIFY_ROOM_PREFIX,
  NOTIFY_SCHEDULE_HOOK,
  notifyChannelCapability,
  PermissionLevel,
  SCHEDULE_CAPABILITY,
  notifyInboxRoom,
  type NotificationImportance,
  type CoreDeviceRevokedEvent,
  type NotifyBusCapability,
  type ScheduleCapability,
} from '@makekeeper/plugin-contract';
import { notifyManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { NotifyController } from './notify.controller';
import { NotifyService } from './notify.service';
import { NotifyDeliveryService } from './delivery.service';
import { NotifyActionsService } from './notify-actions.service';
import { NotifyJob } from './notify.job';
import { WebPushService, WEB_PUSH_CHANNEL_ID } from './web-push.service';

@Module({
  imports: [PrismaModule, AppConfigModule, SecretBoxModule],
  controllers: [NotifyController],
  providers: [
    NotifyService,
    NotifyDeliveryService,
    NotifyActionsService,
    NotifyJob,
    WebPushService,
  ],
  exports: [NotifyService, NotifyDeliveryService, WebPushService],
})
export class NotifyPluginModule
  implements OnModuleInit, OnApplicationBootstrap
{
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly notify: NotifyService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly realtime: RealtimeService,
    private readonly webPush: WebPushService,
    private readonly events: PluginEventBusService,
  ) {}

  onModuleInit(): void {
    this.registry.register(notifyManifest);
    this.i18n.registerBundle({ en, ru });

    // The bus is a capability, not an import: an emitter resolves it per call
    // and treats null (notify disabled) as "nobody to tell" (§5.10).
    this.capabilities.registerCapability<NotifyBusCapability>(
      notifyManifest.id,
      NOTIFY_BUS_CAPABILITY,
      {
        post: (input) => this.notify.post(input),
        declareTypes: (pluginId, types) =>
          this.notify.declareTypes(pluginId, types),
        registerActionHook: (pluginId, hook, handler) =>
          this.notify.registerActionHook(pluginId, hook, handler),
      },
    );

    // Web push is a channel like any other — registered under the same prefix
    // an external plugin would use, so nothing about the delivery path treats
    // the built-in one specially (#311).
    this.capabilities.registerCapability(
      notifyManifest.id,
      notifyChannelCapability(WEB_PUSH_CHANNEL_ID),
      this.webPush.asChannel(),
    );

    // A revoked device stops authenticating, but its browser keeps whatever
    // push endpoint it was handed — so unless we drop the subscription here,
    // an unpaired phone goes on receiving notifications (#311). The core
    // announces the revoke; deleting push rows is notify's own business, which
    // is why this is a listener and not something the core reaches in to do.
    this.events.on<CoreDeviceRevokedEvent>(
      notifyManifest.id,
      CORE_DEVICE_REVOKED_EVENT,
      (payload) => this.webPush.forgetDevice(payload.deviceId),
    );

    // An inbox is private, so a socket may join exactly one room: its own.
    this.realtime.registerRoomAuthorizer(
      notifyManifest.id,
      NOTIFY_ROOM_PREFIX,
      (userId, room) => room === notifyInboxRoom(userId),
    );
  }

  // Telling somebody something is what most schedules are for, so the bus
  // registers the hook the scheduler fires — READ, because it writes no domain
  // data, and `collapse`, because seven identical reminders on a Monday morning
  // are worse than one that says it is a week overdue.
  //
  // On bootstrap, not module init: the scheduler is a capability, and waiting
  // removes any dependence on module order (#308).
  onApplicationBootstrap(): void {
    const scheduler =
      this.capabilities.getCapability<ScheduleCapability>(SCHEDULE_CAPABILITY);
    scheduler?.registerHook(
      notifyManifest.id,
      {
        hookId: NOTIFY_SCHEDULE_HOOK,
        labelKey: 'notify.hook.say',
        level: PermissionLevel.READ,
        misfire: 'collapse',
      },
      async (context) => {
        const type = context.params['type'];
        const titleKey = context.params['titleKey'];
        if (typeof type !== 'string' || typeof titleKey !== 'string') return;
        const bodyKey = context.params['bodyKey'];
        const importance = context.params['importance'];
        await this.notify.post({
          type,
          // The schedule's owner is the person told. A shared schedule reaches
          // the scope it belongs to; a personal one reaches only its creator.
          target: context.ownerUserId
            ? { kind: 'user', userId: context.ownerUserId }
            : { kind: 'audience', scopeId: context.scopeId, audience: 'scope' },
          titleKey,
          bodyKey: typeof bodyKey === 'string' ? bodyKey : undefined,
          params: {
            // What the person named the schedule, and how much of it this one
            // firing stands for.
            title: String(context.params['title'] ?? ''),
            occurrences: context.occurrences,
          },
          ref: context.ref,
          importance: isImportance(importance) ? importance : undefined,
          // One schedule, one standing unread row: a reminder that fired while
          // nobody was looking should not become a pile.
          dedupKey: `schedule:${context.scheduleId}`,
          actions: [
            { kind: 'open' },
            // The schedule is what holds the future moment, so the action
            // names it: the bus moves that, not the row.
            { kind: 'snooze', scheduleId: context.scheduleId },
            { kind: 'dismiss' },
          ],
        });
      },
    );
  }
}

const isImportance = (value: unknown): value is NotificationImportance =>
  value === 'low' || value === 'normal' || value === 'high';
