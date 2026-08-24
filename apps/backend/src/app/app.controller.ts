import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  PluginRegistryService,
  PluginConfigService,
  RequestContextService,
  AdminOnly,
  Public,
} from '@makekeeper/backend-core';
import { PluginPublic } from '@makekeeper/plugin-contract';
import { AppService } from './app.service';
import { UpdatePluginDto } from './app.dto';

@Controller()
@ApiTags('core')
@ApiBearerAuth()
@ApiOAuth2([])
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly pluginConfig: PluginConfigService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Public()
  @Get()
  getData() {
    return this.appService.getData();
  }

  // Every registered plugin's manifest augmented with its EFFECTIVE state:
  // instance-level enablement, narrowed by the caller's per-user/grant plugin
  // set when the multiuser overlay populated the request context. Public so
  // the SPA can render its shell before login (manifests are not sensitive).
  @Public()
  @Get('plugins')
  getPlugins(): PluginPublic[] {
    const enabledForUser = this.requestContext.get()?.enabledPluginIds;
    return this.pluginRegistry.getPlugins().map((manifest) => {
      const instanceEnabled = this.pluginConfig.isEnabled(manifest.id);
      return {
        ...manifest,
        instanceEnabled,
        isEnabled:
          instanceEnabled &&
          (enabledForUser ? enabledForUser.has(manifest.id) : true),
      };
    });
  }

  // Admin toggle. Core plugins reject being disabled (enforced in the service).
  @AdminOnly()
  @Patch('plugins/:id')
  async updatePlugin(
    @Param('id') id: string,
    @Body() body: UpdatePluginDto,
  ): Promise<{ pluginId: string; isEnabled: boolean }> {
    await this.pluginConfig.setEnabled(id, body.isEnabled);
    return { pluginId: id, isEnabled: body.isEnabled };
  }
}
