import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '@makekeeper/backend-core';
import type { DemoClearResult, DemoStatus } from '@makekeeper/plugin-contract';
import { DemoService } from './demo.service';

// The demo dataset's two questions: is this instance showing demo data, and
// remove it. App-level rather than plugin-owned — the set spans every plugin's
// models, so no single plugin can own it.
//
// Dismissing the banner is deliberately NOT here: "I have seen this" is a
// per-browser preference, not instance state, and making it a server row would
// let the first visitor hide the notice from everyone else.
@Controller('demo')
@ApiTags('core')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  // Readable by any signed-in user: the banner is shown to everyone who can see
  // the demo rows, not only to the admin who can remove them.
  @Get()
  @ApiOperation({ summary: 'i18n:core.demo.statusSummary' })
  status(): Promise<DemoStatus> {
    return this.demo.getStatus();
  }

  // Destructive, and instance-wide — admin only. With the multiuser overlay off
  // the guard passes through, which is right: a single-user instance is its own
  // admin. The SPA gates it behind a confirm.
  @AdminOnly()
  @Post('clear')
  @ApiOperation({ summary: 'i18n:core.demo.clearSummary' })
  clear(): Promise<DemoClearResult> {
    return this.demo.clear();
  }
}
