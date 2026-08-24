import { Global, Module } from '@nestjs/common';
import { PluginI18nService } from './plugin-i18n.service';

// Global so any plugin backend can inject PluginI18nService (to register its own
// locale bundle and resolve keys) without re-importing the module — server-side
// i18n is cross-cutting infrastructure, like AppConfig.
@Global()
@Module({
  providers: [PluginI18nService],
  exports: [PluginI18nService],
})
export class PluginI18nModule {}
