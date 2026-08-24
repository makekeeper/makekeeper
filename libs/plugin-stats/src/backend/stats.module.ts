import { Module, OnModuleInit } from '@nestjs/common';
import { statsManifest } from '../manifest';
import {
  ExchangeRegistryService,
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
  createTableDumpProvider,
} from '@makekeeper/backend-core';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { StatsAggregationJob } from './stats.aggregation.job';

// The stats plugin (ticket #56). Owns the daily aggregate table, the rollup job
// and the series API; consumes the stats providers other plugins register into
// `StatsRegistryService`. `PrismaModule`, `StatsRegistryModule` and
// `RequestContextModule` are all @Global, and `ScheduleModule.forRoot()` is
// wired once at the app root — so nothing extra is imported here.
@Module({
  controllers: [StatsController],
  providers: [StatsService, StatsAggregationJob],
  exports: [StatsService],
})
export class StatsPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(statsManifest);
    this.i18n.registerBundle({ en, ru });
    // Instance backup (#62): the daily aggregates verbatim.
    this.exchangeRegistry.registerSectionProvider(
      'stats',
      createTableDumpProvider({
        sectionKey: 'stats.all',
        models: ['statsDaily'],
        prisma: this.prisma,
      }),
    );
  }
}
