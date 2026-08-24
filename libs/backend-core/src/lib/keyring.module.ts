import { Global, Module } from '@nestjs/common';
import { KeyringService } from './keyring.service';

// Global: the multiuser overlay arms DEKs here, and any plugin that stores
// per-user secrets reads them — without importing the multiuser plugin.
@Global()
@Module({
  providers: [KeyringService],
  exports: [KeyringService],
})
export class KeyringModule {}
