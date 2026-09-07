import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly, RequestContextService } from '@makekeeper/backend-core';
import type {
  TelemetryPayload,
  TelemetryState,
} from '@makekeeper/plugin-contract';
import { TelemetryService } from './telemetry.service';
import { SetTelemetryConsentDto } from './telemetry.dto';

// Opt-in liveness telemetry (#343). App-level rather than plugin-owned, like
// the demo dataset: the decision is about the installation as a whole, and no
// plugin can speak for it.
//
// Admin-only throughout, including the read. In multi-user mode a regular user
// neither decides this nor needs to know the instance id; in single-user mode
// the sole user is the admin, so nothing is hidden from anyone who could act
// on it.
@Controller('telemetry')
@ApiTags('core')
@AdminOnly()
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'i18n:core.telemetry.stateSummary' })
  state(): Promise<TelemetryState> {
    return this.telemetry.getState();
  }

  // What a report would carry, built by the sender itself. The consent dialog
  // and the settings fold render THIS rather than a description of it, so the
  // promise on screen and the bytes on the wire cannot drift apart. Reading it
  // sends nothing.
  @Get('preview')
  @ApiOperation({ summary: 'i18n:core.telemetry.previewSummary' })
  preview(): Promise<TelemetryPayload> {
    return this.telemetry.getPreview(this.requestContext.get()?.locale);
  }

  @Post('consent')
  @ApiOperation({ summary: 'i18n:core.telemetry.consentSummary' })
  consent(@Body() dto: SetTelemetryConsentDto): Promise<TelemetryState> {
    return this.telemetry.setConsent(
      dto.granted,
      this.requestContext.get()?.locale,
    );
  }

  // "I have been asked." Separate from the answer on purpose — see
  // `TelemetryService.markPrompted`.
  @Post('prompted')
  @ApiOperation({ summary: 'i18n:core.telemetry.promptedSummary' })
  prompted(): Promise<TelemetryState> {
    return this.telemetry.markPrompted();
  }
}
