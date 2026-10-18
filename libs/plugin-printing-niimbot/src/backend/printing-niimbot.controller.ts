import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminOnly,
  PluginOwner,
  Public,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import type {
  PrintHandoffLink,
  PrintRasterPayload,
} from '@makekeeper/plugin-contract';
import {
  CreateHandoffDto,
  UpdateNiimbotHaSettingsDto,
  UpdateNiimbotPrintSettingsDto,
} from './printing-niimbot.dto';
import { PrintHandoffService } from './print-handoff.service';
import {
  NiimbotHaSettingsService,
  type NiimbotHaSettings,
} from './ha-print-settings.service';
import { NiimbotPrintSettingsService } from './print-settings.service';
import type { NiimbotPrintSettings } from '../print-contract';
import {
  NiimbotHaPrintDriverService,
  type NiimbotHaPreviewResult,
  type NiimbotHaPrinters,
} from './ha-print-driver.service';

// The handoff link's three routes (#361). Gated by the plugin's enabled state
// (`@PluginOwner`), so disabling the driver takes the link mechanism with it.
//
// Two of them are `@Public()`: the page they serve runs in a browser with no
// session — that is the entire point — and is authenticated by the unguessable,
// short-lived, attempt-limited token in its URL, which carries nothing but the
// page to print.
@PluginOwner('printing-niimbot')
@Controller('printing-niimbot')
@ApiTags('printing-niimbot')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PrintingNiimbotController {
  constructor(
    private readonly handoff: PrintHandoffService,
    private readonly printSettings: NiimbotPrintSettingsService,
    private readonly haSettings: NiimbotHaSettingsService,
    private readonly haDriver: NiimbotHaPrintDriverService,
  ) {}

  @Post('handoff')
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.handoff.create' })
  create(
    @Body() body: CreateHandoffDto,
    @Req() req: RequestHeadersLike,
    @Headers('x-locale') locale?: string,
  ): Promise<PrintHandoffLink> {
    return this.handoff.create(body, req, locale);
  }

  @Public()
  @Get('handoff/:token')
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.handoff.claim' })
  claim(@Param('token') token: string): Promise<PrintRasterPayload> {
    return this.handoff.claim(token);
  }

  @Public()
  @Post('handoff/:token/printed')
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.handoff.printed' })
  async printed(@Param('token') token: string): Promise<{ ok: true }> {
    await this.handoff.markPrinted(token);
    return { ok: true };
  }

  // ── How the printer prints (#366) ─────────────────────────────────────────
  //
  // Readable by anyone who can print, because the browser's own driver needs
  // these two values to send a job at all; writable by an admin only, because
  // there is one printer with one roll in it and the setting is the instance's.
  //
  // `@Public()` on the read for one reason: the handoff page (#361) runs the
  // same driver in a browser with NO session — that is the entire point of it —
  // and a 401 there means a phone prints somebody's label at the wrong burn on
  // the wrong stock. What it discloses is a number from 1 to 5 and which roll
  // is loaded, which is less than the label itself already shows.

  @Public()
  @Get('print-settings')
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.print.read' })
  printGet(): Promise<NiimbotPrintSettings> {
    return this.printSettings.get();
  }

  @Put('print-settings')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.print.write' })
  printUpdate(
    @Body() body: UpdateNiimbotPrintSettingsDto,
  ): Promise<NiimbotPrintSettings> {
    return this.printSettings.update(body);
  }

  // ── Printing through Home Assistant (#364) ────────────────────────────────
  //
  // Instance administration, unlike this plugin's per-browser settings: the
  // server prints, so the printer is the instance's and one admin picks it for
  // everybody. Hence `@AdminOnly()` here while the plugin's manifest stays
  // open — the Bluetooth half of its settings panel belongs to whoever is
  // looking at it.

  @Get('ha/settings')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.ha.read' })
  haGet(): Promise<NiimbotHaSettings> {
    return this.haSettings.get();
  }

  @Put('ha/settings')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.ha.write' })
  haUpdate(
    @Body() body: UpdateNiimbotHaSettingsDto,
  ): Promise<NiimbotHaSettings> {
    return this.haSettings.update(body);
  }

  @Get('ha/printers')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.ha.printers' })
  haPrinters(): Promise<NiimbotHaPrinters> {
    return this.haDriver.listPrinters();
  }

  @Post('ha/preview')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:printingNiimbot.api.ha.preview' })
  haPreview(
    @Body() body: UpdateNiimbotHaSettingsDto,
  ): Promise<NiimbotHaPreviewResult> {
    // The screen's own values, so the dry run proves the configuration being
    // edited rather than the one last saved.
    return this.haDriver.testPreview(body);
  }
}
