import { Module, OnModuleInit } from '@nestjs/common';
import {
  AgentRegistryService,
  CapabilityRegistryService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
} from '@makekeeper/backend-core';
import { phoneBridgeKindCapability } from '@makekeeper/plugin-contract';
import { codesManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { CodesController } from './codes.controller';
import { CodesService } from './codes.service';
import { ScanRelayService } from './codes.scan';
import { getCodesTools } from './codes.tools';

@Module({
  imports: [PrismaModule],
  controllers: [CodesController],
  providers: [CodesService, ScanRelayService],
  exports: [CodesService],
})
export class CodesPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly codes: CodesService,
    private readonly scan: ScanRelayService,
  ) {}

  onModuleInit(): void {
    this.registry.register(codesManifest);
    this.i18n.registerBundle({ en, ru });
    this.agentRegistry.registerTools(getCodesTools(this.codes));
    // Codes is a phone-bridge consumer (#77): register the "scan" kind handler
    // so the bridge relays decoded strings here for the desktop to resolve. The
    // bridge owns the session/tunnel/QR/route — codes owns only the scan relay.
    this.capabilities.registerCapability<ScanRelayService>(
      'codes',
      phoneBridgeKindCapability('scan'),
      this.scan,
    );
  }
}
