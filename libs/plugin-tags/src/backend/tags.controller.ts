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
import { PluginOwner } from '@makekeeper/backend-core';
import { TagsService } from './tags.service';
import { TagSourcesService } from './tag-sources.service';
import {
  AssignTagDto,
  CreateTagDto,
  SetTagSourceDto,
  TagsForRefsDto,
  TagSourceStatusDto,
  UnassignTagDto,
  UpdateTagDto,
} from './tags.dto';
import type { TagDto, TaggedObjectDto, TagsForRefsResult } from '../tags-types';

// All routes gated by the tags plugin's enable/disable state (@PluginOwner):
// disabling tags 404s every endpoint, so hosts degrade to "no tags".
@PluginOwner('tags')
@Controller('tags')
@ApiTags('tags')
@ApiBearerAuth()
@ApiOAuth2([])
export class TagsController {
  constructor(
    private readonly tags: TagsService,
    private readonly sources: TagSourcesService,
  ) {}

  @Get()
  listTags(@Query('q') q?: string): Promise<TagDto[]> {
    return this.tags.listTags(q);
  }

  // Mutations pass the caller's x-locale (injected by apiFetch) down so thrown
  // errors reach the user's toasts in their own language (§5.5).
  @Post()
  createTag(
    @Body() body: CreateTagDto,
    @Headers('x-locale') locale?: string,
  ): Promise<TagDto> {
    return this.tags.createTag({ name: body.name, color: body.color }, locale);
  }

  @Post('assign')
  assign(
    @Body() body: AssignTagDto,
    @Headers('x-locale') locale?: string,
  ): Promise<TagDto> {
    return this.tags.assign(body.tag, body.ref, locale);
  }

  @Post('unassign')
  async unassign(@Body() body: UnassignTagDto): Promise<{ ok: true }> {
    await this.tags.unassign(body.tagId, body.ref);
    return { ok: true };
  }

  // Which of these fields turn their value into a tag (#205). Under this
  // plugin's @PluginOwner like everything else here, so disabling tags 404s it
  // and the contributed control disappears along with the rest of the plugin.
  @Post('sources/status')
  sourceStatus(
    @Body() body: TagSourceStatusDto,
  ): Promise<Record<string, boolean>> {
    return this.sources.statusFor(body.refs);
  }

  @Post('sources')
  async setSource(
    @Body() body: SetTagSourceDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.sources.setSource(body.ref, body.isSource, locale);
    return { ok: true };
  }

  @Post('for-refs')
  tagsForRefs(@Body() body: TagsForRefsDto): Promise<TagsForRefsResult> {
    return this.tags.tagsForRefs(body.refs);
  }

  @Get(':id/objects')
  objectsForTag(@Param('id') id: string): Promise<TaggedObjectDto[]> {
    return this.tags.objectsForTag(id);
  }

  @Get(':id/refs')
  refsForTag(@Param('id') id: string): Promise<string[]> {
    return this.tags.refsForTag(id);
  }

  @Patch(':id')
  updateTag(
    @Param('id') id: string,
    @Body() body: UpdateTagDto,
    @Headers('x-locale') locale?: string,
  ): Promise<TagDto> {
    return this.tags.updateTag(
      id,
      { name: body.name, color: body.color },
      locale,
    );
  }

  @Delete(':id')
  async deleteTag(
    @Param('id') id: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.tags.deleteTag(id, locale);
    return { ok: true };
  }
}
