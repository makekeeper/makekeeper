import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AgentRegistryService,
  PluginI18nService,
  PluginOwner,
  Public,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { PermissionLevel } from '@makekeeper/plugin-contract';
import { ExternalTokenGuard, externalCallerOf } from './external-token.guard';
import { ExternalPermissionsService } from './external-permissions.service';
import {
  ExternalInstanceService,
  type InstanceMetricSeries,
} from './external-instance.service';
import {
  ExternalInvokeCapabilityDto,
  ExternalInvokeDto,
  ExternalMetricsQueryDto,
} from './external.dto';
import { ExternalCapabilitiesService } from './external-capabilities.service';

// The two API surfaces external plugins call back on (#135).
//
//   /api/external/data/*     — SCOPED surface. Accepts delegated and
//                              background-scoped tokens; every call runs
//                              inside the token's user/scope context, so the
//                              standard Prisma scope policy applies unchanged.
//   /api/external/instance/* — INSTANCE surface. Aggregates only, read-only,
//                              gated by `instance:<pluginId>:read`.
//
// `@Public()` marks these as "not a browser session": authentication is the
// external access token, verified by ExternalTokenGuard, which also installs
// the request context. Nothing here is reachable from a logged-in SPA session.
@PluginOwner('external')
@Public()
@UseGuards(ExternalTokenGuard)
@Controller('external')
@ApiTags('external')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ExternalDataController {
  constructor(
    private readonly permissions: ExternalPermissionsService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly instance: ExternalInstanceService,
    private readonly capabilities: ExternalCapabilitiesService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Discovery: exactly the operations this caller may invoke — a plugin's
  // grant set, or a connection token's ceiling (#249). Alongside the raw
  // descriptionKeys (which a plugin resolves from its own merged bundle), each
  // operation carries its `en`-resolved description and parameter schema so a
  // consumer with no i18n runtime — an MCP client — can mirror the surface
  // 1:1. Fixed at `en` deliberately: per-token locale is a v1 non-goal (#248).
  @Get('data/operations')
  @ApiOperation({ summary: 'i18n:external.api.operations' })
  listOperations(@Req() req: unknown): Array<{
    name: string;
    pluginId: string;
    permission: PermissionLevel;
    descriptionKey: string;
    parameters: unknown;
    description: string;
    resolvedParameters: unknown;
  }> {
    const caller = externalCallerOf(req);
    const tools =
      caller.kind === 'connection'
        ? this.permissions.callableToolsForCeiling(caller.ceiling)
        : this.permissions.callableTools(caller.grants);
    return tools.map((tool) => {
      const resolved = this.i18n.resolveTool(tool, 'en');
      return {
        name: tool.name,
        pluginId: tool.pluginId,
        permission: tool.permission,
        descriptionKey: tool.descriptionKey,
        parameters: tool.parameters,
        description: resolved.description,
        resolvedParameters: resolved.parameters,
      };
    });
  }

  @Post('data/invoke')
  @ApiOperation({ summary: 'i18n:external.api.invoke' })
  async invoke(
    @Req() req: unknown,
    @Body() body: ExternalInvokeDto,
  ): Promise<{ result: unknown }> {
    const caller = externalCallerOf(req);
    if (caller.kind === 'plugin' && caller.class === 'background-instance') {
      // The instance token has no scope to act in: record-level operations are
      // structurally out of its reach, not merely ungranted.
      throw new ForbiddenException(this.i18n.t('external.errors.wrongSurface'));
    }
    const decision =
      caller.kind === 'connection'
        ? this.permissions.decideForCeiling(body.operation, caller.ceiling)
        : this.permissions.decide(body.operation, caller.grants);
    if (decision.allowed === false) {
      if (decision.reason === 'unknown-tool') {
        throw new BadRequestException(
          this.i18n.t('external.errors.unknownOperation'),
        );
      }
      throw new ForbiddenException(
        this.i18n.t(
          decision.reason === 'destructive'
            ? 'external.errors.destructiveDenied'
            : 'external.errors.permissionDenied',
        ),
      );
    }
    try {
      // Runs inside the caller's request context (installed by the guard), so
      // the scope policy applies exactly as it would for that user's own call.
      const result = await decision.tool.handler(body.args ?? {});
      return { result };
    } catch (err: unknown) {
      // Handler errors are the plugin's business, not a core failure — pass
      // the message (already an i18n key or resolved text) through as a 400.
      throw new BadRequestException(getErrorMessage(err));
    }
  }

  // The instance and capability surfaces are grant-driven and plugin-only: a
  // connection token has a ceiling, not grants, so nothing here is reachable
  // with one (#249).
  private pluginCallerOf(
    req: unknown,
  ): Extract<ReturnType<typeof externalCallerOf>, { kind: 'plugin' }> {
    const caller = externalCallerOf(req);
    if (caller.kind !== 'plugin') {
      throw new ForbiddenException(this.i18n.t('external.errors.wrongSurface'));
    }
    return caller;
  }

  @Get('instance/metrics')
  @ApiOperation({ summary: 'i18n:external.api.metrics' })
  async metrics(
    @Req() req: unknown,
    @Query() query: ExternalMetricsQueryDto,
  ): Promise<InstanceMetricSeries> {
    const caller = this.pluginCallerOf(req);
    const readable = this.permissions.instanceReadablePlugins(caller.grants);
    if (!readable.includes(query.pluginId)) {
      throw new ForbiddenException(
        this.i18n.t('external.errors.permissionDenied'),
      );
    }
    return this.instance.metrics({
      pluginId: query.pluginId,
      metricKey: query.metricKey,
      days: query.days ?? 30,
      byScope: query.byScope === true,
      callerPluginId: caller.pluginId,
    });
  }

  // Capability invocation (#138): the grant is `capability:<id>`, confirmed at
  // install. Between two third-party plugins the core relays opaque JSON and
  // validates nothing about the contract — the authors own it.
  @Post('capability')
  @ApiOperation({ summary: 'i18n:external.api.capability' })
  async invokeCapability(
    @Req() req: unknown,
    @Body() body: ExternalInvokeCapabilityDto,
  ): Promise<{ result: unknown }> {
    const caller = this.pluginCallerOf(req);
    if (!caller.grants.includes(`capability:${body.capability}`)) {
      throw new ForbiddenException(
        this.i18n.t('external.errors.permissionDenied'),
      );
    }
    const res = await this.capabilities.invokeForExternal({
      capability: body.capability,
      method: body.method,
      args: body.args ?? [],
    });
    if (res.ok === false) {
      // "Unregistered", "owner disabled" and "owner failed" collapse to one
      // answer for the consumer: the feature is not available right now.
      throw new BadRequestException(
        this.i18n.t('external.errors.capabilityUnavailable'),
      );
    }
    return { result: res.result };
  }

  @Get('instance/metric-keys')
  @ApiOperation({ summary: 'i18n:external.api.metricKeys' })
  async metricKeys(
    @Req() req: unknown,
    @Query('pluginId') pluginId: string,
  ): Promise<string[]> {
    const caller = this.pluginCallerOf(req);
    if (
      !this.permissions
        .instanceReadablePlugins(caller.grants)
        .includes(pluginId)
    ) {
      throw new ForbiddenException(
        this.i18n.t('external.errors.permissionDenied'),
      );
    }
    return this.instance.availableMetrics(pluginId);
  }
}
