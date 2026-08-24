import { Body, Controller, Get, Headers, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  PluginI18nService,
  PluginOwner,
  RequestContextService,
} from '@makekeeper/backend-core';
import { MyPluginState } from '@makekeeper/plugin-contract';
import { UserPluginService } from './user-plugin.service';
import { UpdateMyPluginDto } from './multiuser.dto';
import { requireUserId } from './require-user';

// The caller's personal plugin set (overlay on the instance-level config).
@PluginOwner('multiuser')
@Controller('multiuser/my-plugins')
@ApiTags('multiuser')
@ApiBearerAuth()
@ApiOAuth2([])
export class MyPluginsController {
  constructor(
    private readonly userPlugins: UserPluginService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  @Get()
  list(@Headers('x-locale') locale?: string): Promise<MyPluginState[]> {
    return this.userPlugins.getStatesFor(this.userId(locale));
  }

  @Patch(':pluginId')
  async update(
    @Param('pluginId') pluginId: string,
    @Body() dto: UpdateMyPluginDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.userPlugins.setEnabled(
      this.userId(locale),
      pluginId,
      dto.isEnabled,
      locale,
    );
    return { ok: true };
  }

  private userId(locale?: string): string {
    return requireUserId(this.requestContext, this.i18n, locale);
  }
}
