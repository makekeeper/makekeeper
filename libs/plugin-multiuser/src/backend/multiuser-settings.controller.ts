import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { AdminOnly, PluginOwner } from '@makekeeper/backend-core';
import { MultiuserSettingsPublic } from '@makekeeper/plugin-contract';
import { MultiuserSettingsService } from './multiuser-settings.service';
import { UpdateMultiuserSettingsDto } from './multiuser.dto';

// Mode administration (registration policy). Anonymous callers learn the
// registration state through the public /auth/status instead.
@PluginOwner('multiuser')
@Controller('multiuser/settings')
@ApiTags('multiuser')
@ApiBearerAuth()
@ApiOAuth2([])
export class MultiuserSettingsController {
  constructor(private readonly settings: MultiuserSettingsService) {}

  @AdminOnly()
  @Get()
  get(): Promise<MultiuserSettingsPublic> {
    return this.settings.get();
  }

  @AdminOnly()
  @Patch()
  update(
    @Body() dto: UpdateMultiuserSettingsDto,
  ): Promise<MultiuserSettingsPublic> {
    return this.settings.update({
      ...(dto.allowRegistration !== undefined && {
        allowRegistration: dto.allowRegistration,
      }),
    });
  }
}
