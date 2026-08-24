import { Global, Module } from '@nestjs/common';
import { PluginConfigService } from './plugin-config.service';

@Global()
@Module({
  providers: [PluginConfigService],
  exports: [PluginConfigService],
})
export class PluginConfigModule {}
