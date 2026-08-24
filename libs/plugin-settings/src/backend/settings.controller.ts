import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Headers,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  AdminOnly,
  InstallInfoService,
  PluginOwner,
  Public,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import {
  ApiInfo,
  DeployHookState,
  DeployHookTriggerResult,
  InstallInfo,
  UpdateCheckState,
  UpdateVersionSummary,
} from '@makekeeper/plugin-contract';
import { SettingsService } from './settings.service';
import { UpdateService } from './update.service';
import { DeployHookService } from './deploy-hook.service';
import {
  ApiInfoQueryDto,
  DeployHookSettingsDto,
  UpdateAgentToolDto,
  UpdateCheckSettingsDto,
} from './settings.dto';

@PluginOwner('settings')
@Controller('settings')
@ApiTags('settings')
@ApiBearerAuth()
@ApiOAuth2([])
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly updateService: UpdateService,
    private readonly installInfo: InstallInfoService,
    private readonly deployHook: DeployHookService,
  ) {}

  // Public version summary for the app shell (sidebar version + "newer available"
  // hint). Non-sensitive subset; readable without admin so every user sees it.
  @Public()
  @Get('version')
  async getVersionSummary(): Promise<UpdateVersionSummary> {
    const state = await this.updateService.getState();
    return {
      currentVersion: state.currentVersion,
      latestVersion: state.latestVersion,
      updateAvailable: state.updateAvailable,
      releaseUrl: state.releaseUrl,
    };
  }

  // Where this instance's API lives, plus how long an issued token lasts (#282).
  // A READ surface every signed-in user needs — the token is personal, and
  // nothing here describes the instance's configuration beyond its own address.
  // The caller passes its own `origin`; see `resolvePublicBaseUrlWithSource`.
  @Get('api-info')
  getApiInfo(
    @Req() req: RequestHeadersLike,
    @Query() query: ApiInfoQueryDto,
  ): ApiInfo {
    return this.settingsService.getApiInfo(req, query.origin);
  }

  // Installed version + last-known update state. Instance administration.
  @AdminOnly()
  @Get('updates')
  async getUpdateState(): Promise<UpdateCheckState> {
    return this.updateService.getState();
  }

  // Trigger an on-demand check against the release source.
  @AdminOnly()
  @Post('updates/check')
  async checkForUpdates(): Promise<UpdateCheckState> {
    return this.updateService.checkNow();
  }

  // Environment diagnostics: how this instance was installed (#100). A support
  // hint shown next to the version — never a trigger for an automated action.
  @AdminOnly()
  @Get('install-info')
  getInstallInfo(): InstallInfo {
    return this.installInfo.getInstallInfo();
  }

  // Deploy hook (#101) — the admin's own manager webhook. Read never returns the
  // URL or token, only whether they are set (see DeployHookService).
  @AdminOnly()
  @Get('deploy-hook')
  async getDeployHook(): Promise<DeployHookState> {
    return this.deployHook.getState();
  }

  @AdminOnly()
  @Patch('deploy-hook')
  async updateDeployHook(
    @Body() dto: DeployHookSettingsDto,
    @Headers('x-locale') locale?: string,
  ): Promise<DeployHookState> {
    return this.deployHook.updateSettings(dto, locale);
  }

  // "Update now". The confirmation gate is the caller's (useConfirm, danger
  // tone) — this endpoint never fires on its own, and no agent tool exposes it:
  // redeploying an instance stays a human action.
  @AdminOnly()
  @Post('deploy-hook/trigger')
  async triggerDeployHook(
    @Headers('x-locale') locale?: string,
  ): Promise<DeployHookTriggerResult> {
    return this.deployHook.trigger(locale);
  }

  // Auto-check on/off and the daily UTC hour.
  @AdminOnly()
  @Patch('updates')
  async updateCheckSettings(
    @Body() dto: UpdateCheckSettingsDto,
  ): Promise<UpdateCheckState> {
    return this.updateService.updateSettings(dto);
  }

  // Instance-wide agent tool policy — admin territory in multi-user mode.
  @AdminOnly()
  @Get('agent-tools')
  async getAgentTools() {
    return this.settingsService.getAgentTools();
  }

  // Agent tool policy is instance-wide — admin-gated while multi-user mode is on.
  @AdminOnly()
  @Patch('agent-tools/:name')
  async updateAgentTool(
    @Param('name') name: string,
    @Body() data: UpdateAgentToolDto,
  ) {
    return this.settingsService.updateAgentTool(name, data);
  }
}
