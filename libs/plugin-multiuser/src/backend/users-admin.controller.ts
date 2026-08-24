import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  AdminOnly,
  PluginI18nService,
  PluginOwner,
  RequestContextService,
} from '@makekeeper/backend-core';
import { AdminUserSummary } from '@makekeeper/plugin-contract';
import { UsersAdminService } from './users-admin.service';
import {
  DeleteUserQueryDto,
  ResetUserPasswordDto,
  SetUserBlockedDto,
  SetUserRoleDto,
} from './users-admin.dto';
import { requireUserId } from './require-user';

@PluginOwner('multiuser')
@Controller('multiuser/admin')
@ApiTags('multiuser')
@ApiBearerAuth()
@ApiOAuth2([])
export class UsersAdminController {
  constructor(
    private readonly usersAdmin: UsersAdminService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  @AdminOnly()
  @Get('users')
  listUsers(): Promise<AdminUserSummary[]> {
    return this.usersAdmin.listUsers();
  }

  @AdminOnly()
  @Patch('users/:id/role')
  async setRole(
    @Param('id') id: string,
    @Body() dto: SetUserRoleDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.usersAdmin.setAdmin(
      id,
      dto.isAdmin,
      this.actorId(locale),
      locale,
    );
    return { ok: true };
  }

  @AdminOnly()
  @Patch('users/:id/blocked')
  async setBlocked(
    @Param('id') id: string,
    @Body() dto: SetUserBlockedDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.usersAdmin.setBlocked(
      id,
      dto.blocked,
      this.actorId(locale),
      locale,
    );
    return { ok: true };
  }

  @AdminOnly()
  @Post('users/:id/password')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetUserPasswordDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.usersAdmin.resetPassword(id, dto.password, locale);
    return { ok: true };
  }

  @AdminOnly()
  @Delete('users/:id')
  async deleteUser(
    @Param('id') id: string,
    @Query() query: DeleteUserQueryDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.usersAdmin.deleteUser(
      id,
      this.actorId(locale),
      query.force ?? false,
      locale,
    );
    return { ok: true };
  }

  private actorId(locale?: string): string {
    return requireUserId(this.requestContext, this.i18n, locale);
  }
}
