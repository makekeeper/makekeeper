import { Module, OnModuleInit } from '@nestjs/common';
import { settingsManifest } from '../manifest';
import {
  PluginRegistryService,
  AgentRegistryModule,
  AgentRegistryService,
  PluginI18nService,
  ExchangeRegistryService,
  PrismaService,
  createTableDumpProvider,
} from '@makekeeper/backend-core';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UpdateService } from './update.service';
import { UpdateJob } from './update.job';
import { DeployHookService } from './deploy-hook.service';

import { getSettingsTools } from './settings.tools';

@Module({
  imports: [AgentRegistryModule],
  controllers: [SettingsController],
  providers: [SettingsService, UpdateService, UpdateJob, DeployHookService],
})
export class SettingsPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly settingsService: SettingsService,
    private readonly i18n: PluginI18nService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.registry.register(settingsManifest);
    // Instance backup (#62): plugin toggles + agent-tool policies. Both tables
    // are seeded at bootstrap, so restore overwrites by natural key instead of
    // colliding with the day-one rows. NOTE: the in-memory PluginConfig cache
    // reads the restored rows on next restart.
    this.exchangeRegistry.registerSectionProvider(
      'settings',
      createTableDumpProvider({
        sectionKey: 'settings.instance',
        models: [
          { name: 'pluginConfig', seededIdKey: 'pluginId' },
          { name: 'agentToolConfig', seededIdKey: 'toolName' },
        ],
        prisma: this.prisma,
      }),
    );
    this.i18n.registerBundle({ en, ru });
    this.agentRegistry.registerTools(getSettingsTools(this.settingsService));
  }
}
