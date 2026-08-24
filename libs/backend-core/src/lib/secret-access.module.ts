import { Global, Module } from '@nestjs/common';
import { SecretAccessService } from './secret-access.service';

// Global so any plugin that stores per-user secrets can record an out-of-session
// use without importing another plugin. Depends only on already-global infra
// (Prisma, Realtime, RequestContext).
@Global()
@Module({
  providers: [SecretAccessService],
  exports: [SecretAccessService],
})
export class SecretAccessModule {}
