import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Query,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
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
  Public,
  RealtimeService,
  RequestContextService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_EVENT_PLUGIN_DISABLED,
  EXTERNAL_EVENT_PLUGIN_ENABLED,
  formatObjectRef,
  type ExternalRegisterResponse,
} from '@makekeeper/plugin-contract';
import {
  ExternalPluginAdminView,
  ExternalRegistryService,
} from './external-registry.service';
import { ExternalTokensService } from './external-tokens.service';
import { externalManifest } from '../manifest';
import { ExternalEventsService } from './external-events.service';
import { ExternalToolsService } from './external-tools.service';
import { ExternalExchangeService } from './external-exchange.service';
import { ExternalCapabilitiesService } from './external-capabilities.service';
import {
  ExternalProvisioningService,
  type ProvisionedTokens,
} from './external-provisioning.service';
import {
  ExternalDiscoveryService,
  type AnnounceResult,
  type CandidateView,
  type ClaimResult,
} from './external-discovery.service';
import {
  ExternalSettingsService,
  type SurfaceBudgets,
} from './external-settings.service';
import {
  ExternalAnnounceDto,
  ExternalBudgetsDto,
  ExternalClaimDto,
  ExternalConnectionTokenCreateDto,
  ExternalConnectionTokenLabelDto,
  ExternalPairDto,
  ExternalRegisterDto,
  ExternalSetEnabledDto,
  ExternalTokensDto,
  ExternalUninstallDto,
} from './external.dto';
import type { ExternalConnectionTokenView } from '../external-types';
import { ExternalPubService } from './external-pub.service';

// Structural response shape for the one header the pub-resolve answer carries
// — no Express types, mirroring the repo's other `@Res` call sites.
interface HeaderResponseLike {
  setHeader(name: string, value: string): void;
}

// HTTP surface of the external-plugins host (#133).
//   POST /external/register        — the self-registration endpoint (public:
//                                    authenticated by install token / secret).
//   /external/admin/*              — instance administration (consent, tokens,
//                                    lifecycle) — admin-only under multiuser.
@PluginOwner('external')
@Controller('external')
@ApiTags('external')
@ApiBearerAuth()
@ApiOAuth2([])
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ExternalController {
  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly tokens: ExternalTokensService,
    private readonly events: ExternalEventsService,
    private readonly tools: ExternalToolsService,
    private readonly exchange: ExternalExchangeService,
    private readonly capabilities: ExternalCapabilitiesService,
    private readonly provisioning: ExternalProvisioningService,
    private readonly discovery: ExternalDiscoveryService,
    private readonly settings: ExternalSettingsService,
    private readonly i18n: PluginI18nService,
    private readonly realtime: RealtimeService,
    private readonly requestContext: RequestContextService,
    private readonly pub: ExternalPubService,
  ) {}

  // Routing oracle for the nginx `auth_request` face of the public-path proxy
  // (#250): 200 + `X-Mk-Target` (a full URL, or the literal `pipe` for
  // core-piped plugins), 403 for everything undeclared — nginx renders that
  // as a 404. Public because nginx calls it with no session; the web face
  // blocks direct client access to this path, and the answer leaks nothing
  // but a container address that is unreachable from outside anyway.
  @Public()
  @Get('pub-resolve')
  @ApiOperation({ summary: 'i18n:external.api.pubResolve' })
  async pubResolve(
    @Res({ passthrough: true }) res: HeaderResponseLike,
    @Headers('x-original-uri') originalUri?: string,
  ): Promise<{ ok: true }> {
    const resolution = await this.pub.resolveUri(originalUri ?? '');
    if (!resolution.ok) throw new ForbiddenException();
    res.setHeader(
      'X-Mk-Target',
      resolution.mode === 'pipe' ? 'pipe' : resolution.target,
    );
    return { ok: true };
  }

  // Every admin action that changes the external SET is broadcast, not scoped:
  // the shell projection is instance-wide, and the acting tab is not the only
  // one showing a sidebar. Clients re-read the shell and mount or unmount the
  // plugin live (#150) instead of waiting for a page reload.
  private announceShellChange(): void {
    this.realtime.emitDataChangedForScope([externalManifest.id], null);
  }

  @Public()
  @Post('register')
  @HttpCode(200)
  @ApiOperation({ summary: 'i18n:external.api.register' })
  register(
    @Body() body: ExternalRegisterDto,
  ): Promise<ExternalRegisterResponse> {
    // The registry returns machine codes; a registering plugin is a machine
    // caller, so no prose is resolved here.
    return this.registry.register(body);
  }

  // Token bootstrap (#140). The plugin proves WHO it is with its registration
  // secret and receives WHAT IT MAY DO right now. Kept separate from
  // registration because nothing is granted until the admin consents, and
  // grants change afterwards — so this is called whenever a plugin needs
  // background credentials, and always returns a freshly minted set.
  @Public()
  @Post('tokens')
  @HttpCode(200)
  @ApiOperation({ summary: 'i18n:external.api.tokens' })
  async issueTokens(
    @Body() body: ExternalTokensDto,
  ): Promise<ProvisionedTokens | { error: string }> {
    const plugin = await this.registry.getActive(body.pluginId);
    if (!plugin || plugin.secret !== body.pluginSecret) {
      // One answer for "unknown", "not active yet" and "wrong secret": a
      // caller learns nothing about a plugin it is not.
      return { error: 'unauthorized' };
    }
    const tokens = await this.provisioning.provision(body.pluginId);
    return tokens ?? { error: 'unauthorized' };
  }

  // ── Discovery (#144) ──────────────────────────────────────────────────────
  // Anonymous, and only while a pairing window is open. Everything a candidate
  // says is self-asserted; the admin's pairing code is what makes it credible.

  @Public()
  @Post('announce')
  @HttpCode(200)
  @ApiOperation({ summary: 'i18n:external.api.announce' })
  announce(
    @Body() body: ExternalAnnounceDto,
    @Ip() sourceIp: string,
  ): Promise<AnnounceResult> {
    return this.discovery.announce({
      manifest: body.manifest,
      baseUrl: body.baseUrl,
      announceKey: body.announceKey,
      pairingCode: body.pairingCode,
      sourceIp: sourceIp || null,
    });
  }

  @Public()
  @Post('claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'i18n:external.api.claim' })
  claim(@Body() body: ExternalClaimDto): Promise<ClaimResult> {
    return this.discovery.claim(body.pluginId, body.announceKey);
  }

  // ── Admin surface ─────────────────────────────────────────────────────────

  @AdminOnly()
  @Get('admin/pairing')
  @ApiOperation({ summary: 'i18n:external.api.pairingStatus' })
  pairingStatus(): {
    open: boolean;
    openUntil: string | null;
    knocking: number;
  } {
    return this.discovery.pairingStatus();
  }

  @AdminOnly()
  @Post('admin/pairing')
  @ApiOperation({ summary: 'i18n:external.api.openPairing' })
  openPairing(): Promise<{ openUntil: string }> {
    return this.discovery.openPairing();
  }

  @AdminOnly()
  @Delete('admin/pairing')
  @ApiOperation({ summary: 'i18n:external.api.closePairing' })
  closePairing(): { ok: true } {
    this.discovery.closePairing();
    return { ok: true };
  }

  // ── Time budgets (decision #8: admin-tunable defaults) ───────────────────

  @AdminOnly()
  @Get('admin/budgets')
  @ApiOperation({ summary: 'i18n:external.api.budgets' })
  budgets(): { budgets: SurfaceBudgets; defaults: SurfaceBudgets } {
    return {
      budgets: this.settings.effectiveBudgets(),
      defaults: this.settings.defaultBudgets(),
    };
  }

  @AdminOnly()
  @Patch('admin/budgets')
  @ApiOperation({ summary: 'i18n:external.api.saveBudgets' })
  async saveBudgets(
    @Body() body: ExternalBudgetsDto,
  ): Promise<{ budgets: SurfaceBudgets }> {
    return { budgets: await this.settings.saveBudgets(body) };
  }

  @AdminOnly()
  @Get('admin/candidates')
  @ApiOperation({ summary: 'i18n:external.api.candidates' })
  candidates(@Query('ignored') ignored?: string): Promise<CandidateView[]> {
    return this.discovery.listCandidates(ignored === 'true');
  }

  // Ignoring is not dismissing: containers re-announce every ~20s, so a
  // deleted card returns immediately. The ignore sticks, and undoing it lets
  // the container back in on its next attempt.
  @AdminOnly()
  @Post('admin/candidates/:candidateId/ignore')
  @ApiOperation({ summary: 'i18n:external.api.ignoreCandidate' })
  async ignoreCandidate(
    @Param('candidateId') candidateId: string,
  ): Promise<{ ok: true }> {
    await this.discovery.setIgnored(candidateId, true);
    return { ok: true };
  }

  @AdminOnly()
  @Delete('admin/candidates/:candidateId/ignore')
  @ApiOperation({ summary: 'i18n:external.api.unignoreCandidate' })
  async unignoreCandidate(
    @Param('candidateId') candidateId: string,
  ): Promise<{ ok: true }> {
    await this.discovery.setIgnored(candidateId, false);
    return { ok: true };
  }

  @AdminOnly()
  @Post('admin/candidates/:candidateId/pair')
  @ApiOperation({ summary: 'i18n:external.api.pair' })
  async pair(
    @Param('candidateId') candidateId: string,
    @Body() body: ExternalPairDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    const result = await this.discovery.pair(candidateId, body.code);
    if ('error' in result) {
      const key =
        result.error === 'bad-code'
          ? 'external.errors.badPairingCode'
          : result.error === 'id-taken'
            ? 'external.errors.idTaken'
            : 'external.errors.notFound';
      throw new BadRequestException(this.i18n.t(key, undefined, locale));
    }
    return { ok: true };
  }

  @AdminOnly()
  @Delete('admin/candidates/:candidateId')
  @ApiOperation({ summary: 'i18n:external.api.dismissCandidate' })
  async dismissCandidate(
    @Param('candidateId') candidateId: string,
  ): Promise<{ ok: true }> {
    await this.discovery.dismiss(candidateId);
    return { ok: true };
  }

  @AdminOnly()
  @Get('admin/plugins')
  @ApiOperation({ summary: 'i18n:external.api.list' })
  list(): Promise<ExternalPluginAdminView[]> {
    return this.registry.listAdmin();
  }

  @AdminOnly()
  @Post('admin/install-token')
  @ApiOperation({ summary: 'i18n:external.api.installToken' })
  createInstallToken(): Promise<{ token: string; expiresAt: Date }> {
    return this.tokens.createInstallToken();
  }

  // ── Connection tokens (#249) ─────────────────────────────────────────────
  // Long-lived `mkt_` credentials for outside consumers (MCP clients). Every
  // call keys on the ISSUING user: under multiuser each admin sees and
  // manages only their own tokens; single-user mode issues with no user.

  private connectionTokenOwner(): string | null {
    return this.requestContext.get()?.userId ?? null;
  }

  @AdminOnly()
  @Get('admin/connection-tokens')
  @ApiOperation({ summary: 'i18n:external.api.connectionTokens' })
  connectionTokens(): Promise<ExternalConnectionTokenView[]> {
    return this.tokens.listConnection(this.connectionTokenOwner());
  }

  @AdminOnly()
  @Post('admin/connection-tokens')
  @ApiOperation({ summary: 'i18n:external.api.createConnectionToken' })
  createConnectionToken(
    @Body() body: ExternalConnectionTokenCreateDto,
  ): Promise<{ token: string; view: ExternalConnectionTokenView }> {
    const ctx = this.requestContext.get();
    return this.tokens.issueConnection(
      body.label,
      body.ceiling,
      ctx?.userId ?? null,
      ctx?.scopeId ?? null,
    );
  }

  @AdminOnly()
  @Patch('admin/connection-tokens/:tokenId')
  @ApiOperation({ summary: 'i18n:external.api.relabelConnectionToken' })
  async relabelConnectionToken(
    @Param('tokenId') tokenId: string,
    @Body() body: ExternalConnectionTokenLabelDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    const done = await this.tokens.relabelConnection(
      tokenId,
      this.connectionTokenOwner(),
      body.label,
    );
    if (!done) {
      throw new NotFoundException(
        this.i18n.t('external.errors.notFound', undefined, locale),
      );
    }
    return { ok: true };
  }

  @AdminOnly()
  @Delete('admin/connection-tokens/:tokenId')
  @ApiOperation({ summary: 'i18n:external.api.revokeConnectionToken' })
  async revokeConnectionToken(
    @Param('tokenId') tokenId: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    const done = await this.tokens.revokeConnection(
      tokenId,
      this.connectionTokenOwner(),
    );
    if (!done) {
      throw new NotFoundException(
        this.i18n.t('external.errors.notFound', undefined, locale),
      );
    }
    return { ok: true };
  }

  @AdminOnly()
  @Post('admin/plugins/:pluginId/approve')
  @ApiOperation({ summary: 'i18n:external.api.approve' })
  async approve(
    @Param('pluginId') pluginId: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.run(() => this.registry.approve(pluginId), locale);
    // An approved update may add or drop tools; re-sync rather than leaving a
    // stale name callable.
    await this.tools.syncPlugin(pluginId);
    // Same for the capabilities it offers: boot-time registration alone would
    // leave a plugin approved later publishing nothing.
    await this.capabilities.syncPlugin(pluginId);
    // A block that was waiting for this plugin can now be handed over — the
    // "import first, install later" order is the normal restore sequence.
    await this.exchange.applyDeferred(pluginId);
    // Consent just changed what the plugin may do; mint the matching tokens
    // now rather than waiting for it to ask.
    await this.provisioning.provision(pluginId);
    this.announceShellChange();
    return { ok: true };
  }

  @AdminOnly()
  @Post('admin/plugins/:pluginId/reject')
  @ApiOperation({ summary: 'i18n:external.api.reject' })
  async reject(
    @Param('pluginId') pluginId: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.run(() => this.registry.reject(pluginId), locale);
    return { ok: true };
  }

  @AdminOnly()
  @Patch('admin/plugins/:pluginId/enabled')
  @ApiOperation({ summary: 'i18n:external.api.setEnabled' })
  async setEnabled(
    @Param('pluginId') pluginId: string,
    @Body() body: ExternalSetEnabledDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.run(
      () => this.registry.setEnabled(pluginId, body.enabled),
      locale,
    );
    // Lifecycle events are published here rather than inside the registry: the
    // events service reads the registry, so emitting from there would close a
    // DI cycle. The admin action is the transaction boundary anyway.
    await this.events.publish({
      type: body.enabled
        ? EXTERNAL_EVENT_PLUGIN_ENABLED
        : EXTERNAL_EVENT_PLUGIN_DISABLED,
      // WHICH plugin travels as a canonical ref, not as payload data — the
      // envelope carries no values (#189 decision 7).
      ref:
        formatObjectRef({
          pluginId: externalManifest.id,
          entityType: 'plugin',
          entityId: pluginId,
        }) ?? undefined,
    });
    // A disabled plugin's tools and capability offers go with it immediately.
    await this.tools.syncPlugin(pluginId);
    await this.capabilities.syncPlugin(pluginId);
    this.announceShellChange();
    return { ok: true };
  }

  @AdminOnly()
  @Delete('admin/plugins/:pluginId')
  @ApiOperation({ summary: 'i18n:external.api.uninstall' })
  async uninstall(
    @Param('pluginId') pluginId: string,
    @Body() body: ExternalUninstallDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true; purgeFailed: boolean }> {
    const res = await this.run(
      () => this.registry.uninstall(pluginId, body.purge === true),
      locale,
    );
    // Undelivered events and registered tools must not outlive the plugin.
    await this.events.forgetPlugin(pluginId);
    await this.tools.syncPlugin(pluginId);
    await this.capabilities.syncPlugin(pluginId);
    this.announceShellChange();
    return { ok: true, purgeFailed: res.purgeFailed };
  }

  // Deferred exchange blocks (#138): data of plugins that were not installed
  // when an archive was imported. Listed so the admin sees what is waiting.
  @AdminOnly()
  @Get('admin/deferred-blobs')
  @ApiOperation({ summary: 'i18n:external.api.deferredBlobs' })
  deferredBlobs(): Promise<
    Array<{ id: string; pluginId: string; createdAt: string; size: number }>
  > {
    return this.exchange.listDeferred();
  }

  @AdminOnly()
  @Delete('admin/deferred-blobs/:blobId')
  @ApiOperation({ summary: 'i18n:external.api.discardDeferred' })
  async discardDeferred(
    @Param('blobId') blobId: string,
  ): Promise<{ ok: true }> {
    await this.exchange.discardDeferred(blobId);
    return { ok: true };
  }

  // Assistant consent (#137): a SEPARATE decision from installing the plugin.
  // Default off; turning it on lists exactly which tools the model gains.
  @AdminOnly()
  @Patch('admin/plugins/:pluginId/assistant')
  @ApiOperation({ summary: 'i18n:external.api.setAssistantEnabled' })
  async setAssistantEnabled(
    @Param('pluginId') pluginId: string,
    @Body() body: ExternalSetEnabledDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.run(
      () => this.registry.setAssistantEnabled(pluginId, body.enabled),
      locale,
    );
    await this.tools.syncPlugin(pluginId);
    return { ok: true };
  }

  // Delivery visibility: what the plugin never received, and a way to push it
  // again once the cause is fixed (decision #10 — dead letters must be seen,
  // not silently dropped).
  @AdminOnly()
  @Get('admin/plugins/:pluginId/dead-letters')
  @ApiOperation({ summary: 'i18n:external.api.deadLetters' })
  deadLetters(@Param('pluginId') pluginId: string): Promise<
    Array<{
      id: string;
      type: string;
      attempts: number;
      lastError: string | null;
      occurredAt: string;
    }>
  > {
    return this.events.deadLetters(pluginId);
  }

  @AdminOnly()
  @Post('admin/deliveries/:deliveryId/redeliver')
  @ApiOperation({ summary: 'i18n:external.api.redeliver' })
  async redeliver(
    @Param('deliveryId') deliveryId: string,
  ): Promise<{ ok: true }> {
    await this.events.redeliver(deliveryId);
    return { ok: true };
  }

  // Maps the registry's stable error codes onto HTTP with a localized message
  // resolved from this plugin's bundle (§5.5) — never literal prose.
  private async run<T>(
    fn: () => Promise<T>,
    locale: string | undefined,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = getErrorMessage(err);
      if (code === 'not-found') {
        throw new NotFoundException(
          this.i18n.t('external.errors.notFound', undefined, locale),
        );
      }
      if (code === 'not-pending') {
        throw new BadRequestException(
          this.i18n.t('external.errors.notPending', undefined, locale),
        );
      }
      if (code === 'manifest-unreadable') {
        throw new BadRequestException(
          this.i18n.t('external.errors.manifestUnreadable', undefined, locale),
        );
      }
      throw err;
    }
  }
}
