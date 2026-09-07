import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

// Imports nothing: PrismaModule, AppConfigModule, PluginI18nModule,
// RealtimeModule and RequestContextModule are all global in the app root.
@Module({
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
