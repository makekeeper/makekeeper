import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  Public,
  PluginOwner,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import { CodesService, type ResolvedLabel } from './codes.service';
import { EnsureLabelDto, PreviewScanDto, ResolveScanDto } from './codes.dto';

// All routes gated by the codes plugin's enable/disable state (@PluginOwner):
// disabling codes 404s every endpoint, so labelling/scanning simply disappears.
@PluginOwner('codes')
@Controller('codes')
@ApiTags('codes')
@ApiBearerAuth()
@ApiOAuth2([])
export class CodesController {
  constructor(private readonly codes: CodesService) {}

  // Permanent public label deep-link resolver (`/c/<code>` → the object's ref).
  // Public: a phone's native camera opens it with no app session.
  @Public()
  @Get('c/:code')
  async resolveCode(
    @Param('code') code: string,
  ): Promise<{ ref: string | null }> {
    return { ref: await this.codes.resolveCode(code) };
  }

  // Create (or return the existing) label for an object — used by the print
  // dialog. The absolute deep-link is built from the request host.
  @Post('labels')
  ensureLabel(
    @Body() body: EnsureLabelDto,
    @Req() req: RequestHeadersLike,
    @Headers('x-locale') locale?: string,
  ): Promise<ResolvedLabel> {
    return this.codes.ensureLabel(body.ref, req, locale);
  }

  // The existing label for an object, or null (print dialog preflight).
  @Get('labels/by-ref')
  getByRef(
    @Query('ref') ref: string,
    @Req() req: RequestHeadersLike,
  ): Promise<ResolvedLabel | null> {
    return this.codes.getByRef(ref ?? '', req);
  }

  // Resolve a raw scanned string (our code, an ORef, or a foreign barcode/SKU)
  // to a canonical object ref — used by the desktop after the phone relays a scan.
  @Post('scan/resolve')
  async resolveScan(
    @Body() body: ResolveScanDto,
  ): Promise<{ ref: string | null }> {
    return { ref: await this.codes.resolveScan(body.value) };
  }

  // Phone-side scan preview: what the scanned value points to (name + location),
  // so the phone can confirm before the desktop navigates. Public — the phone
  // page has no app session — so it is gated on the caller's live phone-bridge
  // session token (`body.token`) instead, keeping anonymous callers from
  // harvesting object names.
  @Public()
  @Post('scan/preview')
  previewScan(@Body() body: PreviewScanDto): Promise<{
    value: string;
    ref: string | null;
    displayName: string | null;
    breadcrumb: string | null;
  }> {
    return this.codes.previewScan(body.value, body.token);
  }
}
