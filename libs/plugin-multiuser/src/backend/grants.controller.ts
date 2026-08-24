import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  PluginI18nService,
  PluginOwner,
  RequestContextService,
  ScopeRestrictionRegistryService,
} from '@makekeeper/backend-core';
import {
  GrantPublic,
  RestrictionUiDescriptor,
} from '@makekeeper/plugin-contract';
import { GrantsService } from './grants.service';
import { UsersService } from './users.service';
import { PrismaService } from '@makekeeper/backend-core';
import { CreateGrantDto, UpdateGrantDto } from './multiuser.dto';
import { requireUserId } from './require-user';

// Owner-side sharing management: my grants, the restriction pick-lists the
// plugins announce for my scope, and the user directory for the grantee
// picker. Everything here acts on the CALLER (never on scope data), so it
// works from any active scope.
@PluginOwner('multiuser')
@Controller('multiuser')
@ApiTags('multiuser')
@ApiBearerAuth()
@ApiOAuth2([])
export class GrantsController {
  constructor(
    private readonly grants: GrantsService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly restrictions: ScopeRestrictionRegistryService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  @Get('grants')
  async listGrants(
    @Headers('x-locale') locale?: string,
  ): Promise<GrantPublic[]> {
    return this.grants.listForOwner(this.userId(locale));
  }

  @Post('grants')
  createGrant(
    @Body() dto: CreateGrantDto,
    @Headers('x-locale') locale?: string,
  ): Promise<GrantPublic> {
    return this.grants.create(this.userId(locale), dto, locale);
  }

  @Patch('grants/:id')
  updateGrant(
    @Param('id') id: string,
    @Body() dto: UpdateGrantDto,
    @Headers('x-locale') locale?: string,
  ): Promise<GrantPublic> {
    return this.grants.update(this.userId(locale), id, dto, locale);
  }

  @Delete('grants/:id')
  async deleteGrant(
    @Param('id') id: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.grants.remove(this.userId(locale), id, locale);
    return { ok: true };
  }

  // The plugin-announced restriction sections, with their pick-lists resolved
  // for MY scope (the sharing UI renders these generically).
  @Get('restrictions')
  async listRestrictions(
    @Headers('x-locale') locale?: string,
  ): Promise<RestrictionUiDescriptor[]> {
    const ownerScopeId = this.userId(locale);
    // Resolve the pick-lists against the CALLER'S OWN scope, not whatever scope
    // they may be browsing. The descriptors query `where: { scopeId: owner }`,
    // and the active-scope policy would otherwise AND-merge the browsed scope's
    // id — two different scopeIds match nothing, emptying the owner's own lists.
    return this.requestContext.runWithoutScope(
      'restriction-descriptors',
      async () => {
        const result: RestrictionUiDescriptor[] = [];
        for (const descriptor of this.restrictions.getAll()) {
          result.push({
            pluginId: descriptor.pluginId,
            resourceKey: descriptor.resourceKey,
            labelKey: descriptor.labelKey,
            options: await descriptor.listOptions(ownerScopeId),
          });
        }
        return result;
      },
    );
  }

  // Minimal directory for the grantee picker — every registered user is
  // listable by name (documented trade-off of open registration).
  @Get('users/options')
  async listUserOptions(
    @Headers('x-locale') locale?: string,
  ): Promise<{ id: string; label: string }[]> {
    const selfId = this.userId(locale);
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, username: true, displayName: true },
    });
    return users
      .filter((user) => user.id !== selfId)
      .map((user) => ({
        id: user.id,
        label: user.displayName ?? user.username,
      }));
  }

  private userId(locale?: string): string {
    return requireUserId(this.requestContext, this.i18n, locale);
  }
}
