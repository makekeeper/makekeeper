import { Global, Module } from '@nestjs/common';
import { SecretBoxService } from './secret-box.service';

// Global so any plugin backend can inject SecretBoxService without re-importing.
// Boot-critical: its onModuleInit aborts startup when APP_SECRET is missing.
// (AppConfigModule is @Global, so no explicit import is needed.)
@Global()
@Module({
  providers: [SecretBoxService],
  exports: [SecretBoxService],
})
export class SecretBoxModule {}
