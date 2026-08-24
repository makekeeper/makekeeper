import { Global, Module } from '@nestjs/common';
import { StatsRegistryService } from './stats-registry.service';

@Global()
@Module({
  providers: [StatsRegistryService],
  exports: [StatsRegistryService],
})
export class StatsRegistryModule {}
