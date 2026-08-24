import { Global, Module } from '@nestjs/common';
import { ScopeRestrictionRegistryService } from './scope-restriction-registry.service';

@Global()
@Module({
  providers: [ScopeRestrictionRegistryService],
  exports: [ScopeRestrictionRegistryService],
})
export class ScopeRestrictionRegistryModule {}
