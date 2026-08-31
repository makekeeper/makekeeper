import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { AppService } from './app.service';
import { UploadsController } from './uploads.controller';
import { DiskUsageController } from './disk-usage.controller';
import { RefsController } from './refs.controller';
import {
  PrismaModule,
  PluginRegistryModule,
  AgentRegistryModule,
  StatsRegistryModule,
  ExchangeRegistryModule,
  CapabilityRegistryModule,
  PluginEventBusModule,
  PluginConfigModule,
  PluginI18nModule,
  PluginI18nService,
  AppConfigModule,
  TransliterationModule,
  InstallInfoModule,
  AttachmentStorageModule,
  PluginEnabledGuard,
  RequestContextModule,
  RealtimeModule,
  ScopeRestrictionRegistryModule,
  SecretBoxModule,
  KeyringModule,
  DeviceAuthModule,
  DeviceTokenGuard,
  SecretAccessModule,
} from '@makekeeper/backend-core';
// Core (non-plugin) i18n: backend-only messages with no owning plugin —
// guard/exception text from shared infrastructure and the Swagger doc strings.
// Same per-locale JSON shape as every plugin bundle.
import coreEn from './i18n/en.json';
import coreRu from './i18n/ru.json';

import { ProjectsPluginModule } from '@makekeeper/plugin-projects/backend';
import { InventoryPluginModule } from '@makekeeper/plugin-inventory/backend';
import { LogisticsPluginModule } from '@makekeeper/plugin-logistics/backend';
import { SettingsPluginModule } from '@makekeeper/plugin-settings/backend';
import { ChatModule } from '@makekeeper/plugin-chat/backend';
import { StoragesPluginModule } from '@makekeeper/plugin-storages/backend';
import { CapturePluginModule } from '@makekeeper/plugin-capture/backend';
import { PhoneBridgePluginModule } from '@makekeeper/plugin-phone-bridge/backend';
import { MultiuserPluginModule } from '@makekeeper/plugin-multiuser/backend';
import { UxModePluginModule } from '@makekeeper/plugin-uxmode/backend';
import { StatsPluginModule } from '@makekeeper/plugin-stats/backend';
import { TagsPluginModule } from '@makekeeper/plugin-tags/backend';
import { ExchangePluginModule } from '@makekeeper/plugin-exchange/backend';
import { CodesPluginModule } from '@makekeeper/plugin-codes/backend';
import { MobilePluginModule } from '@makekeeper/plugin-mobile/backend';
import { ExternalPluginModule } from '@makekeeper/plugin-external/backend';
import { NotifyPluginModule } from '@makekeeper/plugin-notify/backend';
import { SchedulePluginModule } from '@makekeeper/plugin-schedule/backend';

@Module({
  imports: [
    // Enables @Cron scheduling app-wide (the stats aggregation job). forRoot is
    // called exactly once, here at the app root.
    ScheduleModule.forRoot(),
    PrismaModule,
    AppConfigModule,
    TransliterationModule,
    InstallInfoModule,
    AttachmentStorageModule,
    PluginRegistryModule,
    PluginConfigModule,
    PluginI18nModule,
    RequestContextModule,
    RealtimeModule,
    ScopeRestrictionRegistryModule,
    SecretBoxModule,
    KeyringModule,
    DeviceAuthModule,
    SecretAccessModule,
    // Registered before the plugins that post to it, so their type
    // declarations find the bus capability already in the registry.
    NotifyPluginModule,
    SchedulePluginModule,
    ProjectsPluginModule,
    InventoryPluginModule,
    LogisticsPluginModule,
    SettingsPluginModule,
    ChatModule,
    StoragesPluginModule,
    PhoneBridgePluginModule,
    CapturePluginModule,
    MultiuserPluginModule,
    UxModePluginModule,
    StatsPluginModule,
    TagsPluginModule,
    ExchangePluginModule,
    CodesPluginModule,
    MobilePluginModule,
    ExternalPluginModule,
    AgentRegistryModule,
    StatsRegistryModule,
    ExchangeRegistryModule,
    CapabilityRegistryModule,
    PluginEventBusModule,
  ],
  controllers: [
    AppController,
    HealthController,
    UploadsController,
    DiskUsageController,
    RefsController,
  ],
  providers: [
    AppService,
    // Global gate: requests to a disabled plugin's routes are rejected.
    { provide: APP_GUARD, useClass: PluginEnabledGuard },
    // Makes revoking a paired phone bite while the multiuser overlay is off
    // (#199): a presented Bearer token must be a live device token. Stands
    // aside entirely when the overlay is on — that guard owns authentication.
    { provide: APP_GUARD, useClass: DeviceTokenGuard },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly i18n: PluginI18nService) {}

  // Core (non-plugin) messages have no owning plugin module to register them, so
  // the app shell seeds them itself at bootstrap.
  onModuleInit(): void {
    this.i18n.registerBundle({ en: coreEn, ru: coreRu });
  }
}
