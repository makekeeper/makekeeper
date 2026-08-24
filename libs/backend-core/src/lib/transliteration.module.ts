import { Global, Module } from '@nestjs/common';
import { TransliterationService } from './transliteration.service';

// Global for the same reason as AppConfigModule: transliteration is
// cross-cutting infrastructure any plugin backend may need, and the tables are
// read once at startup regardless of who injects the service.
@Global()
@Module({
  providers: [TransliterationService],
  exports: [TransliterationService],
})
export class TransliterationModule {}
