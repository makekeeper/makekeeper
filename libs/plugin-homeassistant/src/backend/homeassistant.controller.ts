import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly, PluginOwner } from '@makekeeper/backend-core';
import { isHomeAssistantFailure } from '@makekeeper/plugin-contract';
import { UpdateHomeAssistantSettingsDto } from './homeassistant.dto';
import {
  HomeAssistantSettingsService,
  normalizeBaseUrl,
} from './homeassistant-settings.service';
import type {
  HomeAssistantSettingsPublic,
  HomeAssistantTestResult,
} from '../settings-contract';
import { HomeAssistantClientService } from './homeassistant-client.service';

// The connection, and nothing else (#364).
//
// Every route is instance administration: one address and one token serve
// everybody, so `@AdminOnly()` guards them in code while the manifest's
// `settingsAdminOnly` only hides the panel. `@PluginOwner` makes the whole
// surface vanish with the plugin — and with it the capability, which is how
// "disable Home Assistant and HA printing disappears" works.
@PluginOwner('homeassistant')
@Controller('homeassistant')
@ApiTags('homeassistant')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class HomeAssistantController {
  constructor(
    private readonly settings: HomeAssistantSettingsService,
    private readonly client: HomeAssistantClientService,
  ) {}

  @Get('settings')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:homeassistant.api.settings.read' })
  get(): Promise<HomeAssistantSettingsPublic> {
    return this.settings.get();
  }

  @Put('settings')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:homeassistant.api.settings.write' })
  update(
    @Body() body: UpdateHomeAssistantSettingsDto,
  ): Promise<HomeAssistantSettingsPublic> {
    return this.settings.update(body);
  }

  @Post('settings/test')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'i18n:homeassistant.api.settings.test' })
  async test(
    @Body() body: UpdateHomeAssistantSettingsDto,
  ): Promise<HomeAssistantTestResult> {
    // The typed address is normalised the same way saving normalises it, so
    // the check cannot pass on a URL the save would then reject (or fail on a
    // trailing slash the save would have stripped).
    const typedUrl = body.baseUrl ? normalizeBaseUrl(body.baseUrl) : null;
    if (body.baseUrl && !typedUrl) {
      return { ok: false, errorKey: 'homeassistant.errors.badUrl' };
    }
    const probe = await this.client.probe({
      baseUrl: typedUrl,
      // A blank token means "keep the stored one" everywhere else, so it means
      // the same here: the check then tests the connection that is saved.
      token: body.token ? body.token : null,
    });
    if (isHomeAssistantFailure(probe)) {
      return { ok: false, errorKey: probe.errorKey, status: probe.status };
    }
    return {
      ok: true,
      version: probe.data.version,
      entityCount: probe.data.entityCount,
    };
  }
}
