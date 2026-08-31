import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentRegistryService } from '@makekeeper/backend-core';
import type { ResolvedObjectRef } from '@makekeeper/backend-core';

// What an `mk://` reference is, for a screen that has one and wants to show a
// LINK rather than a line of protocol (#323).
//
// Core rather than a plugin: the resolvers are registered by whoever owns the
// entity type, and the answer is assembled by the registry that already does
// this for the agent's `resolve_object_ref`. A plugin asking another plugin for
// a name would be the import this architecture exists to prevent (§5.10).
@Controller('refs')
@ApiTags('core')
export class RefsController {
  constructor(private readonly agentRegistry: AgentRegistryService) {}

  @Get('resolve')
  @ApiOperation({ summary: 'i18n:core.refs.resolve' })
  async resolve(@Query('ref') ref: string): Promise<ResolvedObjectRef> {
    // An unknown or unreadable reference is not an error: it is a reference to
    // something that is gone or not the caller's to see, and the screen shows
    // it as plain text instead of a link. The name falls back to the ref, so a
    // caller never has to invent one.
    return (
      (await this.agentRegistry.resolveObjectRef(ref)) ?? {
        ref,
        exists: false,
        displayName: ref,
      }
    );
  }
}
