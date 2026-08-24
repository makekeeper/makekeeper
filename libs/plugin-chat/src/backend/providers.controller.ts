import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ForbiddenException,
  Headers,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import {
  AdminOnly,
  PluginI18nService,
  PluginOwner,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  ProviderService,
  type PublicProviderConfig,
  type TestConnectionResult,
} from './providers.service';
import {
  CreateProviderDto,
  UpdateProviderDto,
  TestProviderDto,
  NormalizeProxyLabelDto,
} from './providers.dto';

// AI provider settings live under the chat plugin (they configure the chat/
// agent runtime). Exposed at /api/chat/providers:
// - instance connections (admin-only in multi-user mode) at the root paths;
// - the caller's PERSONAL connections under /personal — any authenticated
//   user in multi-user mode (always private, never shared).
@PluginOwner('chat')
@Controller('chat/providers')
@ApiTags('chat')
@ApiBearerAuth()
@ApiOAuth2([])
export class ProvidersController {
  constructor(
    private readonly providerService: ProviderService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Normalisation for the form's proxy-label preview (#230). Here and not on
  // the client: the transliteration tables are server data, read from disk at
  // startup, and a browser bundle cannot hold "whatever is in the folder".
  @Post('proxy-label/normalize')
  normalizeProxyLabel(@Body() data: NormalizeProxyLabelDto): {
    normalized: string[];
  } {
    return {
      normalized: this.providerService.normalizeProxyLabelValues(data.values),
    };
  }

  // --- Personal connections (declared before the generic :id routes) ---

  @Get('personal')
  async findPersonal(
    @Headers('x-locale') locale?: string,
  ): Promise<PublicProviderConfig[]> {
    return this.providerService.findPersonal(this.requirePersonal(locale));
  }

  @Post('personal')
  async createPersonal(
    @Body() data: CreateProviderDto,
    @Headers('x-locale') locale?: string,
  ): Promise<PublicProviderConfig> {
    return this.providerService.create(data, this.requirePersonal(locale));
  }

  @Post('personal/test')
  async testPersonal(
    @Body() data: TestProviderDto,
    @Headers('x-locale') locale?: string,
  ): Promise<TestConnectionResult> {
    return this.providerService.testConnection(
      data,
      this.requirePersonal(locale),
      // Untrusted caller: block probes at the server's internal network / cloud
      // metadata (SSRF). Admins keep the unrestricted instance test route.
      { blockPrivateHosts: true },
    );
  }

  // Declared before the :id patterns — "default" must not match as an id.
  @Patch('personal/default/clear')
  async clearPersonalDefault(
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.providerService.clearDefault(this.requirePersonal(locale));
    return { ok: true };
  }

  @Patch('personal/:id/default')
  async setPersonalDefault(
    @Param('id') id: string,
    @Headers('x-locale') locale?: string,
  ): Promise<PublicProviderConfig> {
    return this.providerService.setDefault(id, this.requirePersonal(locale));
  }

  @Patch('personal/:id')
  async updatePersonal(
    @Param('id') id: string,
    @Body() data: UpdateProviderDto,
    @Headers('x-locale') locale?: string,
  ): Promise<PublicProviderConfig> {
    return this.providerService.update(id, data, this.requirePersonal(locale));
  }

  @Delete('personal/:id')
  async deletePersonal(
    @Param('id') id: string,
    @Headers('x-locale') locale?: string,
  ): Promise<PublicProviderConfig> {
    return this.providerService.delete(id, this.requirePersonal(locale));
  }

  // --- Instance connections (admin territory in multi-user mode) ---

  // Config listing is admin territory (multi-user mode); regular users get
  // only the aggregate status below.
  @AdminOnly()
  @Get()
  async findAll(): Promise<PublicProviderConfig[]> {
    return this.providerService.findAll();
  }

  @Get('active-status')
  async activeStatus(): Promise<{ name: string | null; ok: boolean }> {
    return this.providerService.getActiveStatus();
  }

  // The connection a regular user inherits (workspace owner's guest-shared
  // one, else the admin's instance default); shown pinned in the personal
  // panel. Safe for any authenticated user.
  @Get('shared')
  async sharedForUsers(): Promise<{
    connection: PublicProviderConfig;
    source: 'workspace-owner' | 'instance';
  } | null> {
    return this.providerService.getSharedForUsers();
  }

  @AdminOnly()
  @Post()
  async create(@Body() data: CreateProviderDto): Promise<PublicProviderConfig> {
    return this.providerService.create(data, null);
  }

  @AdminOnly()
  @Post('test')
  async test(@Body() data: TestProviderDto): Promise<TestConnectionResult> {
    return this.providerService.testConnection(data);
  }

  @AdminOnly()
  @Patch(':id/default')
  async setDefault(@Param('id') id: string): Promise<PublicProviderConfig> {
    return this.providerService.setDefault(id, null);
  }

  @AdminOnly()
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateProviderDto,
  ): Promise<PublicProviderConfig> {
    return this.providerService.update(id, data, null);
  }

  @AdminOnly()
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<PublicProviderConfig> {
    return this.providerService.delete(id, null);
  }

  // Personal-connection routes require an authenticated multiuser caller —
  // in single-user mode "personal" has no meaning (the guard leaves the
  // request context empty there).
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
