import { Module, OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { promises as fsp } from 'fs';
import { join } from 'path';
import {
  AppConfigService,
  ExchangeRegistryService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
} from '@makekeeper/backend-core';
import { exchangeManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { ExchangeController } from './exchange.controller';
import { ExchangeService } from './exchange.service';
import { ExchangeImportStore } from './import-store';
import {
  createInstanceRootProvider,
  createScopeRootProvider,
} from './instance-root.provider';

// Archive uploads stream straight to disk (an instance backup would not fit
// the JSON body limit); the size cap comes from AppConfigService, the incoming
// directory lives under the same exchange tmp tree the import store sweeps.
@Module({
  imports: [
    PrismaModule,
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: async (config: AppConfigService) => {
        const incoming = join(
          config.getUploadsRoot(),
          'exchange-tmp',
          'incoming',
        );
        await fsp.mkdir(incoming, { recursive: true });
        return {
          storage: diskStorage({ destination: incoming }),
          limits: { fileSize: config.getExchangeUploadLimitBytes(), files: 1 },
        };
      },
    }),
  ],
  controllers: [ExchangeController],
  providers: [ExchangeService, ExchangeImportStore],
})
export class ExchangePluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly i18n: PluginI18nService,
  ) {}

  onModuleInit(): void {
    this.registry.register(exchangeManifest);
    this.i18n.registerBundle({ en, ru });
    this.exchangeRegistry.registerSectionProvider(
      'exchange',
      createInstanceRootProvider(),
    );
    this.exchangeRegistry.registerSectionProvider(
      'exchange',
      createScopeRootProvider(),
    );
  }
}
