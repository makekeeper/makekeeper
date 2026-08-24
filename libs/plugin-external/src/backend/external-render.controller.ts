import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PluginOwner } from '@makekeeper/backend-core';
import { ExternalRenderService } from './external-render.service';
import { ExternalShellService } from './external-shell.service';
import { ExternalActionBodyDto, ExternalRenderBodyDto } from './external.dto';
import type {
  ExternalActionPayload,
  ExternalRenderPayload,
  ExternalShellPlugin,
} from '../external-types';

// SPA-facing render surface (#134). Ordinary authenticated app routes — the
// browser never talks to a plugin container directly; every tree passes
// through the core's sanitizer and every call carries the caller's own
// short-lived delegated token minted server-side.
@PluginOwner('external')
@Controller('external')
@ApiTags('external')
@ApiBearerAuth()
@ApiOAuth2([])
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ExternalRenderController {
  constructor(
    private readonly shell: ExternalShellService,
    private readonly render: ExternalRenderService,
  ) {}

  @Get('shell')
  @ApiOperation({ summary: 'i18n:external.api.shell' })
  getShell(): Promise<ExternalShellPlugin[]> {
    return this.shell.shell();
  }

  @Post('render/:pluginId')
  @ApiOperation({ summary: 'i18n:external.api.render' })
  async renderScreen(
    @Param('pluginId') pluginId: string,
    @Body() body: ExternalRenderBodyDto,
  ): Promise<ExternalRenderPayload> {
    const res = await this.render.render(
      pluginId,
      body.screen,
      body.params ?? {},
      body.surface ?? 'screen',
      body.form,
    );
    if (res.ok === false) return { ok: false, failure: res.failure };
    return { ok: true, screen: res.screen };
  }

  @Post('action/:pluginId')
  @ApiOperation({ summary: 'i18n:external.api.action' })
  async runAction(
    @Param('pluginId') pluginId: string,
    @Body() body: ExternalActionBodyDto,
  ): Promise<ExternalActionPayload> {
    const res = await this.render.action(pluginId, {
      screen: body.screen,
      action: body.action,
      params: body.params ?? {},
      form: body.form,
    });
    if (res.ok === false) return { ok: false, failure: res.failure };
    return { ok: true, ...res.result };
  }
}
