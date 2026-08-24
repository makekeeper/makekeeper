import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  DiskBrowseResult,
  DiskCleanupResult,
  DiskDeleteResult,
  DiskUsageReport,
} from '@makekeeper/plugin-contract';
import { AdminOnly, DiskUsageService } from '@makekeeper/backend-core';
import { DeleteDiskPathsDto } from './disk-usage.dto';

// "What is using the disk" (#120). App-level rather than owned by a plugin, for
// the same reason serving is: the bytes belong to no single plugin — project
// files, chat attachments and phone captures all land in one store.
//
// Its own route rather than a second verb on /api/uploads: that controller
// resolves an opaque id, and a literal path segment sharing the `:id` slot is a
// trap waiting for the day an id stops being `att_`-prefixed.
@Controller('disk')
@ApiTags('core')
export class DiskUsageController {
  constructor(private readonly usage: DiskUsageService) {}

  // Admin-only: it reports across every user's data. With the multiuser overlay
  // off the guard passes through, which is correct — a single-user instance is
  // its own admin.
  @AdminOnly()
  @Get('usage')
  @ApiOperation({ summary: 'i18n:core.diskUsage.summary' })
  report(): Promise<DiskUsageReport> {
    return this.usage.report();
  }

  // Deletes only files no record claims, and only those old enough to be safely
  // judged (the service owns the grace period). Destructive, so the SPA gates it
  // behind a confirm — but nothing recoverable is at stake: these bytes are
  // reachable by no attachment, no project and no chat.
  @AdminOnly()
  @Delete('unreferenced')
  @ApiOperation({ summary: 'i18n:core.diskUsage.purgeSummary' })
  purge(): Promise<DiskCleanupResult> {
    return this.usage.purgeUnreferenced();
  }

  // One level of the uploads tree, directories rolled up to what they contain.
  // `path` is root-relative; anything that tries to climb out normalises away.
  @AdminOnly()
  @Get('browse')
  @ApiOperation({ summary: 'i18n:core.diskUsage.browseSummary' })
  browse(@Query('path') path?: string): Promise<DiskBrowseResult> {
    return this.usage.browse(path ?? '');
  }

  // Delete an explicit selection. POST rather than DELETE because the selection
  // is a body, and a DELETE with a body is refused by enough proxies to make it
  // a bad bet for an operation whose failure mode is "nothing happens".
  @AdminOnly()
  @Post('delete')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'i18n:core.diskUsage.deleteSummary' })
  deletePaths(@Body() dto: DeleteDiskPathsDto): Promise<DiskDeleteResult> {
    return this.usage.deletePaths(dto.paths);
  }
}
