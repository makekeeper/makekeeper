import { Module, OnModuleInit } from '@nestjs/common';
import {
  CapabilityRegistryService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
} from '@makekeeper/backend-core';
import {
  HOMEASSISTANT_API_CAPABILITY,
  type HomeAssistantApiCapability,
} from '@makekeeper/plugin-contract';
import { homeassistantManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { HomeAssistantController } from './homeassistant.controller';
import { HomeAssistantSettingsService } from './homeassistant-settings.service';
import { HomeAssistantClientService } from './homeassistant-client.service';

// The gateway's wiring (#364).
//
// The capability is registered as an explicit three-method adapter rather than
// by handing the service over: the Nest service also carries `probe()` and the
// credentials override its own settings screen needs, and none of that is part
// of what other plugins may rely on. Keeping the two surfaces apart is what
// stops a consumer from reaching past the contract.
@Module({
  imports: [PrismaModule],
  controllers: [HomeAssistantController],
  providers: [HomeAssistantSettingsService, HomeAssistantClientService],
})
export class HomeassistantPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly client: HomeAssistantClientService,
  ) {}

  onModuleInit(): void {
    this.registry.register(homeassistantManifest);
    this.i18n.registerBundle({ en, ru });
    this.capabilities.registerCapability<HomeAssistantApiCapability>(
      homeassistantManifest.id,
      HOMEASSISTANT_API_CAPABILITY,
      {
        isConfigured: () => this.client.isConfigured(),
        getStates: (filter) => this.client.getStates(filter),
        getDevices: (integration) => this.client.getDevices(integration),
        callService: (domain, service, call) =>
          this.client.callService(domain, service, call),
      },
    );
  }
}
