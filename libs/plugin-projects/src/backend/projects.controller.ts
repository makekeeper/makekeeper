import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { PluginOwner } from '@makekeeper/backend-core';
import { ProjectsService, type ProjectFileLocation } from './projects.service';
import { ProjectGroupsService } from './project-groups.service';
import type { ProjectGroupDto } from '../project-groups';
import {
  AddFileDto,
  AddTaskDto,
  CreateProjectDto,
  CreateProjectGroupDto,
  MoveProjectsToGroupDto,
  ReorderProjectGroupsDto,
  UpdateProjectGroupDto,
  LinkComponentDto,
  ReorderProjectsDto,
  SetCoverDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './projects.dto';

@PluginOwner('projects')
@Controller('projects')
@ApiTags('projects')
@ApiBearerAuth()
@ApiOAuth2([])
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly groupsService: ProjectGroupsService,
  ) {}

  // `group` narrows the list to that group and everything below it.
  @Get()
  async findAll(@Query('group') group?: string) {
    return this.projectsService.findAll(group);
  }

  // ── Groups ────────────────────────────────────────────────────────────────
  // Literal paths, so none of them is swallowed by the `:id` param route.

  @Get('groups')
  async listGroups(): Promise<ProjectGroupDto[]> {
    return this.groupsService.list();
  }

  @Post('groups')
  async createGroup(
    @Body() body: CreateProjectGroupDto,
  ): Promise<ProjectGroupDto> {
    return this.groupsService.create(body);
  }

  // What a delete would move, and where — the counts the confirmation states.
  @Get('groups/:groupId/delete-preview')
  async previewGroupDelete(@Param('groupId') groupId: string) {
    return this.groupsService.deletePreview(groupId);
  }

  @Patch('groups/move-projects')
  async moveProjectsToGroup(@Body() body: MoveProjectsToGroupDto) {
    return this.groupsService.moveProjects(body.projectIds, body.groupId);
  }

  @Patch('groups/reorder')
  async reorderGroups(
    @Body() body: ReorderProjectGroupsDto,
  ): Promise<ProjectGroupDto[]> {
    return this.groupsService.reorder(body);
  }

  @Patch('groups/:groupId')
  async updateGroup(
    @Param('groupId') groupId: string,
    @Body() body: UpdateProjectGroupDto,
  ): Promise<ProjectGroupDto> {
    return this.groupsService.update(groupId, body);
  }

  @Delete('groups/:groupId')
  async deleteGroup(@Param('groupId') groupId: string) {
    return this.groupsService.delete(groupId);
  }

  // Literal path — must precede the `:id` param route so it isn't swallowed.
  @Get('bench')
  async getBench() {
    return this.projectsService.getBench();
  }

  // Where a stored file lives (#112). A `mk://projects/file/<id>` ORef names
  // the attachment, not its project, so a link to one has to ask — the same
  // shape the task ORef lacks, resolved instead of given up on. Literal path,
  // so it precedes the `:id` route.
  @Get('files/:attachmentId')
  async findFile(
    @Param('attachmentId') attachmentId: string,
  ): Promise<ProjectFileLocation | null> {
    return this.projectsService.findFile(attachmentId);
  }

  @Post()
  async create(@Body() body: CreateProjectDto) {
    return this.projectsService.create(body);
  }

  // Two-segment path so it can never be swallowed by the `:id` param route.
  @Patch('board/reorder')
  async reorder(@Body() body: ReorderProjectsDto) {
    return this.projectsService.reorderProjects(
      body.status,
      body.orderedIds,
      body.movedId,
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProjectDto) {
    return this.projectsService.update(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.projectsService.delete(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Post(':id/components')
  async linkComponent(
    @Param('id') projectId: string,
    @Body() body: LinkComponentDto,
  ) {
    return this.projectsService.linkComponent(
      projectId,
      body.componentId,
      body.neededQty,
    );
  }

  @Delete(':id/components/:componentId')
  async unlinkComponent(
    @Param('id') projectId: string,
    @Param('componentId') componentId: string,
  ) {
    return this.projectsService.unlinkComponent(projectId, componentId);
  }

  @Patch(':id/tasks/:taskId')
  async updateTask(
    @Param('taskId') taskId: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.projectsService.updateTask(taskId, body);
  }

  @Get(':id/tasks/:taskId')
  async getTaskDetails(@Param('taskId') taskId: string) {
    return this.projectsService.getTaskDetails(taskId);
  }

  @Post(':id/tasks')
  async addTask(@Param('id') id: string, @Body() body: AddTaskDto) {
    return this.projectsService.addTask(id, body.title);
  }

  @Delete(':id/tasks/:taskId')
  async deleteTask(@Param('taskId') taskId: string) {
    return this.projectsService.deleteTask(taskId);
  }

  @Get(':id/shopping-list')
  async shoppingList(@Param('id') id: string) {
    return this.projectsService.getShoppingList(id);
  }

  @Get(':id/files')
  async listFiles(@Param('id') id: string) {
    return this.projectsService.listFiles(id);
  }

  @Post(':id/files')
  async addFile(@Param('id') id: string, @Body() body: AddFileDto) {
    return this.projectsService.addFile(id, body.data, body.filename);
  }

  @Delete(':id/files/:attachmentId')
  async deleteFile(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.projectsService.deleteFile(id, attachmentId);
  }

  @Patch(':id/cover')
  async setCover(@Param('id') id: string, @Body() body: SetCoverDto) {
    return this.projectsService.setCover(id, body.attachmentId ?? null);
  }
}
