import { Global, Module } from '@nestjs/common';
import { ExchangeRegistryService } from './exchange-registry.service';

@Global()
@Module({
  providers: [ExchangeRegistryService],
  exports: [ExchangeRegistryService],
})
export class ExchangeRegistryModule {}
