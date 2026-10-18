import { Module, OnModuleInit } from '@nestjs/common';
import {
  CapabilityRegistryService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
} from '@makekeeper/backend-core';
import {
  printDriverCapability,
  type PrintDriverCapability,
} from '@makekeeper/plugin-contract';
import { printingNiimbotManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { PrintingNiimbotController } from './printing-niimbot.controller';
import { PrintHandoffService } from './print-handoff.service';
import { NiimbotHaSettingsService } from './ha-print-settings.service';
import { NiimbotPrintSettingsService } from './print-settings.service';
import { NiimbotHaPrintDriverService } from './ha-print-driver.service';

// Backend side of the Niimbot driver.
//
// The driver itself is a BROWSER thing — Web Bluetooth exists nowhere else — so
// there is no device code here. What the server owns is the handoff link
// (#361): the parked raster for a browser that cannot reach the printer, plus
// the manifest registration that makes the plugin toggleable like any other
// (which is how "disable it and the print button disappears" works at all).
@Module({
  imports: [PrismaModule],
  controllers: [PrintingNiimbotController],
  providers: [
    PrintHandoffService,
    NiimbotPrintSettingsService,
    NiimbotHaSettingsService,
    NiimbotHaPrintDriverService,
  ],
})
export class PrintingNiimbotPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly haDriver: NiimbotHaPrintDriverService,
  ) {}

  onModuleInit(): void {
    this.registry.register(printingNiimbotManifest);
    this.i18n.registerBundle({ en, ru });
    // The server-side route to the same printer family (#364): a driver that
    // reaches a Niimbot through the household's Home Assistant instead of
    // through this tab's Bluetooth. It offers itself only once there is a
    // Home Assistant to use and a printer chosen on it — `describe()` answers
    // `null` otherwise — so registering it unconditionally adds no row to
    // anybody's print dialog.
    this.capabilities.registerCapability<PrintDriverCapability>(
      printingNiimbotManifest.id,
      printDriverCapability(printingNiimbotManifest.id),
      this.haDriver,
    );
  }
}
