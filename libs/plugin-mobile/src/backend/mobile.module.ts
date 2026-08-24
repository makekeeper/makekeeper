import { Module, OnModuleInit } from '@nestjs/common';
import {
  DeviceAuthService,
  ExchangeRegistryService,
  LoginThrottleGuard,
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import { mobileManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { MobileController } from './mobile.controller';
import { DevicesController } from './devices.controller';
import { MobileSettingsService } from './mobile-settings.service';
import { MobileOriginService } from './mobile-origin.service';
import { createMobileExchangeProvider } from './mobile.exchange';

// The mobile surface's backend (#198/#199/#204, extracted from the core).
//
// It consumes the phone-bridge tunnel through a capability rather than an import
// (§5.10): without phone-bridge there is simply no tunnel, and the plugin says
// so instead of failing.
@Module({
  controllers: [MobileController, DevicesController],
  providers: [MobileSettingsService, MobileOriginService, LoginThrottleGuard],
  exports: [MobileSettingsService, MobileOriginService],
})
export class MobilePluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly exchange: ExchangeRegistryService,
    private readonly prisma: PrismaService,
    private readonly devices: DeviceAuthService,
    private readonly settings: MobileSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(mobileManifest);
    this.i18n.registerBundle({ en, ru });
    // Instance backup (#62): the settings singleton. Paired devices are
    // deliberately NOT exported — a credential is not configuration.
    this.exchange.registerSectionProvider(
      'mobile',
      createMobileExchangeProvider(this.prisma),
    );
    // A phone working through the tunnel keeps it alive. The tunnel's idle timer
    // only counts BRIDGE sessions, so without this it stopped mid-shelf under a
    // person who was very much still using it — the mobile app creates no bridge
    // session, and silence read as absence.
    this.devices.onDeviceActivity(() => {
      this.settings.tunnel()?.touch();
    });
  }
}
