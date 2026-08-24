import { Global, Module } from '@nestjs/common';
import { PluginEventBusService } from './plugin-event-bus.service';

@Global()
@Module({
  providers: [PluginEventBusService],
  exports: [PluginEventBusService],
})
export class PluginEventBusModule {}
