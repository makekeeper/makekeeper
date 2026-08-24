import { Module, OnModuleInit } from '@nestjs/common';
import {
  PrismaModule,
  AttachmentStorageModule,
  PluginRegistryService,
  PluginI18nService,
  CapabilityRegistryService,
  ExchangeRegistryService,
  AttachmentStorageService,
  PrismaService,
} from '@makekeeper/backend-core';
import { phoneBridgeKindCapability } from '@makekeeper/plugin-contract';
import { captureManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { CaptureService } from './capture.service';
import { createCaptureExchangeProviders } from './capture.exchange';

@Module({
  imports: [PrismaModule, AttachmentStorageModule],
  providers: [CaptureService],
})
export class CapturePluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly capture: CaptureService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly attachments: AttachmentStorageService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(captureManifest);
    this.i18n.registerBundle({ en, ru });
    // Instance backup (#62): attachment rows + binaries (the media tree).
    for (const provider of createCaptureExchangeProviders(
      this.prisma,
      this.attachments,
    )) {
      this.exchangeRegistry.registerSectionProvider('capture', provider);
    }
    // Capture is a phone-bridge consumer (#77): register the "capture" kind
    // handler so the bridge routes relayed photos here. The bridge owns the
    // session/tunnel/QR/route/realtime — capture owns only the photo payload.
    this.capabilities.registerCapability<CaptureService>(
      'capture',
      phoneBridgeKindCapability('capture'),
      this.capture,
    );
  }
}
