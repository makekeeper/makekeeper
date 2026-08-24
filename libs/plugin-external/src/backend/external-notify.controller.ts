import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PluginI18nService,
  PluginOwner,
  Public,
  RealtimeService,
} from '@makekeeper/backend-core';
import { ExternalTokenGuard, externalCallerOf } from './external-token.guard';
import { ExternalNotifyChangedDto } from './external.dto';
import { ExternalScopeRefService } from './external-scope-ref.service';

// Plugin → client realtime (#136, decision #11).
//
// Invalidation ONLY: the plugin says "screen X of scope Y is stale", the core
// relays it over its OWN scoped `data-changed` socket, and viewing clients
// refetch the render through the normal proxy. The push channel never carries
// content, so (a) all UI still passes the vocabulary + sanitizer, and (b)
// scoping stays with the core — the plugin names a scope, it does not choose
// recipients.
@PluginOwner('external')
@Public()
@UseGuards(ExternalTokenGuard)
@Controller('external')
@ApiTags('external')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ExternalNotifyController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly scopeRefs: ExternalScopeRefService,
    private readonly i18n: PluginI18nService,
  ) {}

  @Post('notify-changed')
  @ApiOperation({ summary: 'i18n:external.api.notifyChanged' })
  async notifyChanged(
    @Req() req: unknown,
    @Body() body: ExternalNotifyChangedDto,
  ): Promise<{ ok: true }> {
    const caller = externalCallerOf(req);
    if (caller.kind !== 'plugin') {
      // Invalidation names a plugin's own screens — a connection token (#249)
      // has no screens to invalidate, so the surface is out of its reach.
      throw new ForbiddenException(this.i18n.t('external.errors.wrongSurface'));
    }
    // The scope is taken from the TOKEN, not the body, whenever the token has
    // one: a per-scope plugin must not be able to nudge another scope's
    // clients by naming it. Only an instance-class token may target a scope
    // explicitly (it legitimately acts across scopes) — and what it names is
    // its OPAQUE scope reference (decision #5), resolved back here. A ref
    // that resolves to nothing nudges nobody.
    const scopeId =
      caller.scopeId ??
      (caller.class === 'background-instance' && body.scopeId
        ? await this.scopeRefs.fromRef(caller.pluginId, body.scopeId)
        : null);
    // Screens only: this says the plugin's own screen is stale, and nothing
    // about the core's data. A printer pushing a temperature every fifteen
    // seconds must not make every open view in the app refetch.
    this.realtime.emitDataChangedForScope([caller.pluginId], scopeId, {
      screensOnly: true,
    });
    return { ok: true };
  }
}
