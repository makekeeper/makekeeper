import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminOnly,
  AppConfigService,
  PluginOwner,
  Public,
} from '@makekeeper/backend-core';
import type {
  MobileOriginInfo,
  MobileSettingsPublic,
} from '@makekeeper/plugin-contract';
import { mobileOriginVerdict } from './mobile-origin';
import { MobileSettingsService } from './mobile-settings.service';
import { MobileOriginService } from './mobile-origin.service';
import { UpdateMobileSettingsDto } from './mobile.dto';

@PluginOwner('mobile')
@Controller('mobile')
@ApiTags('mobile')
@ApiBearerAuth()
@ApiOAuth2([])
export class MobileController {
  constructor(
    private readonly config: AppConfigService,
    private readonly settings: MobileSettingsService,
    private readonly origins: MobileOriginService,
  ) {}

  // Public on purpose: the shell asks this BEFORE anyone is paired, to decide
  // whether offering "install to home screen" would be a lie (#198). It leaks
  // nothing the caller does not already know — it is a verdict about the address
  // they typed.
  @Public()
  @Get('origin')
  @ApiOperation({ summary: 'i18n:mobile.api.origin.summary' })
  async getOrigin(@Req() req: Request): Promise<MobileOriginInfo> {
    const secure = this.config.isRequestSecure(req.headers);
    const host =
      firstHeader(req.headers['x-forwarded-host']) ?? req.headers['host'] ?? '';
    const origin = `${secure ? 'https' : 'http'}://${host}`;
    return {
      verdict: mobileOriginVerdict(host, secure),
      origin,
      mobileOrigin: await this.origins.resolveConfigured(),
      canPair: await this.origins.canPair(req, origin),
    };
  }

  @AdminOnly()
  @Get('settings')
  @ApiOperation({ summary: 'i18n:mobile.api.settings.summary' })
  async getSettings(): Promise<MobileSettingsPublic> {
    return this.settings.getPublic();
  }

  @AdminOnly()
  @Patch('settings')
  @ApiOperation({ summary: 'i18n:mobile.api.settings.updateSummary' })
  async updateSettings(
    @Body() body: UpdateMobileSettingsDto,
  ): Promise<MobileSettingsPublic> {
    return this.settings.update(body);
  }
}

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);
