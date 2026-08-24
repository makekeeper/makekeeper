import { Global, Module } from '@nestjs/common';
import { InstallInfoService } from './install-info.service';

// Global for the same reason as AppConfigModule: install-method detection is
// cross-cutting environment information any plugin backend may need.
@Global()
@Module({
  providers: [InstallInfoService],
  exports: [InstallInfoService],
})
export class InstallInfoModule {}
