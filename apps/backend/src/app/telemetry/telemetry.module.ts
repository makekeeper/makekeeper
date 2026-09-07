import { Module } from '@nestjs/common';
import { InstallInfoService } from '@makekeeper/backend-core';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

// Imports nothing: PrismaModule, AppConfigModule, PluginConfigModule and
// RequestContextModule are all global in the app root.
@Module({
  controllers: [TelemetryController],
  providers: [TelemetryService, InstallInfoService],
})
export class TelemetryModule {}
