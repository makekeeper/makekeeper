import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminOnly,
  PluginI18nService,
  PluginOwner,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  DEFAULT_ATTACHMENT_RULES,
  type AttachmentRules,
} from '@makekeeper/plugin-contract';
import {
  AttachmentSettingsService,
  type EffectiveAttachmentRules,
} from './attachment-settings.service';
import { AttachmentRulesDto } from './attachment-settings.dto';

// What a settings panel needs to render one ruleset: the stored values, or
// null when this owner stores none and therefore inherits.
interface StoredAttachmentRules {
  rules: AttachmentRules | null;
  defaults: AttachmentRules;
}

// The chat attachment ruleset (#112), exposed at /api/chat/attachment-settings.
// Layout mirrors the connections controller it sits beside: the instance
// ruleset at the root (admin territory in multi-user mode), the caller's own
// under /personal.
@PluginOwner('chat')
@Controller('chat/attachment-settings')
@ApiTags('chat')
@ApiBearerAuth()
@ApiOAuth2([])
export class AttachmentSettingsController {
  constructor(
    private readonly settings: AttachmentSettingsService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  // The rules that actually apply to this caller right now — the gate in the
  // composer asks for exactly this, and never re-derives the cascade itself.
  @Get('effective')
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.effective' })
  async effective(): Promise<EffectiveAttachmentRules> {
    return this.settings.resolveEffective();
  }

  @Get('personal')
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.readPersonal' })
  async readPersonal(
    @Headers('x-locale') locale?: string,
  ): Promise<StoredAttachmentRules> {
    const rules = await this.settings.read(this.requirePersonal(locale));
    return { rules, defaults: DEFAULT_ATTACHMENT_RULES };
  }

  @Put('personal')
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.savePersonal' })
  async savePersonal(
    @Body() body: AttachmentRulesDto,
    @Headers('x-locale') locale?: string,
  ): Promise<AttachmentRules> {
    return this.settings.save(this.requirePersonal(locale), body);
  }

  // Deleting the personal row is how a user returns to the inherited ruleset.
  @Delete('personal')
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.clearPersonal' })
  async clearPersonal(
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.settings.clear(this.requirePersonal(locale));
    return { ok: true };
  }

  @AdminOnly()
  @Get()
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.readInstance' })
  async readInstance(): Promise<StoredAttachmentRules> {
    const rules = await this.settings.read(null);
    return { rules, defaults: DEFAULT_ATTACHMENT_RULES };
  }

  @AdminOnly()
  @Put()
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.saveInstance' })
  async saveInstance(
    @Body() body: AttachmentRulesDto,
  ): Promise<AttachmentRules> {
    return this.settings.save(null, body);
  }

  @AdminOnly()
  @Delete()
  @ApiOperation({ summary: 'i18n:chat.attachmentSettings.api.clearInstance' })
  async clearInstance(): Promise<{ ok: true }> {
    await this.settings.clear(null);
    return { ok: true };
  }

  private requirePersonal(locale?: string): string {
    const rc = this.requestContext.get();
    if (!rc?.userId) {
      throw new ForbiddenException(
        this.i18n.t(
          'providerSettings.validation.personalDisabled',
          undefined,
          locale,
        ),
      );
    }
    return rc.userId;
  }
}
