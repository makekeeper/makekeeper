import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

// Global so any plugin backend can inject AppConfigService without re-importing
// the module — config access is cross-cutting infrastructure.
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
