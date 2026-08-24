import {
  Controller,
  DefaultValuePipe,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Query,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { PluginOwner } from '@makekeeper/backend-core';
import { ChatService } from './chat.service';
import { ChatAnalyticsService } from './chat-analytics.service';
import {
  FilingContextQueryDto,
  SearchMessagesQueryDto,
  PagedSessionsQueryDto,
  UpdateSessionDto,
} from './chat.dto';

@PluginOwner('chat')
@Controller('chat')
@ApiTags('chat')
@ApiBearerAuth()
@ApiOAuth2([])
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatAnalytics: ChatAnalyticsService,
  ) {}

  // Per-day assistant activity (messages + executed tool calls) for the
  // dashboard widget. `days` is clamped to [1, 90] in the service.
  @Get('activity')
  async getActivity(
    @Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number,
  ): ReturnType<ChatAnalyticsService['getActivity']> {
    return this.chatAnalytics.getActivity(days);
  }

  // What the assistant is currently working on (#129): the project it answers
  // about and files uploads into, and the object the open page has published.
  // Resolved on the server because the rules behind both halves live there —
  // a copy in the browser would be free to drift from the code that acts.
  @Get('context')
  async getChatContext(
    @Query() query: FilingContextQueryDto,
  ): ReturnType<ChatService['resolveChatContext']> {
    return this.chatService.resolveChatContext(
      query.refs ? query.refs.split(',').filter(Boolean) : [],
      query.projectId ?? null,
    );
  }

  // Session routes. There is exactly one set of them since #130: a conversation
  // belongs to the user, not to a project, so there is nothing left to key them
  // by. The project-scoped variants that used to live here are gone with the
  // anchor they served.
  @Get('session')
  async getOrCreateSession(): ReturnType<ChatService['getOrCreateSession']> {
    return this.chatService.getOrCreateSession();
  }

  @Get('sessions')
  async listSessions(): ReturnType<ChatService['listSessions']> {
    return this.chatService.listSessions();
  }

  @Post('sessions')
  async createSession(): ReturnType<ChatService['createSession']> {
    return this.chatService.createSession();
  }

  // Project AI-history: paginated conversation list (many chats over time).
  @Get('projects/:projectId/sessions/paged')
  async listSessionsPaged(
    @Param('projectId') projectId: string,
    @Query() query: PagedSessionsQueryDto,
  ): ReturnType<ChatService['listSessionsPaged']> {
    return this.chatService.listSessionsPaged(
      projectId,
      query.limit ?? 10,
      query.offset ?? 0,
    );
  }

  // Project AI-history: full-text search across the project's chat messages.
  @Get('projects/:projectId/messages/search')
  async searchProjectMessages(
    @Param('projectId') projectId: string,
    @Query() query: SearchMessagesQueryDto,
  ): ReturnType<ChatAnalyticsService['searchProjectMessages']> {
    return this.chatAnalytics.searchProjectMessages(
      projectId,
      query.q,
      query.limit ?? 20,
      query.offset ?? 0,
    );
  }

  // Project AI-history: journal of agent tool actions taken in the project.
  @Get('projects/:projectId/journal')
  async getProjectJournal(
    @Param('projectId') projectId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
    @Query('includeRead', new DefaultValuePipe(false), ParseBoolPipe)
    includeRead: boolean,
  ): ReturnType<ChatAnalyticsService['getProjectJournal']> {
    return this.chatAnalytics.getProjectJournal(projectId, days, includeRead);
  }

  // Project AI-history: per-day assistant activity scoped to the project.
  @Get('projects/:projectId/activity')
  async getProjectActivity(
    @Param('projectId') projectId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ): ReturnType<ChatAnalyticsService['getProjectActivity']> {
    return this.chatAnalytics.getProjectActivity(projectId, days);
  }

  // Project AI-history: per-day LLM usage (requests / tokens / errors).
  @Get('projects/:projectId/usage')
  async getProjectUsage(
    @Param('projectId') projectId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ): ReturnType<ChatAnalyticsService['getProjectUsage']> {
    return this.chatAnalytics.getProjectUsage(projectId, days);
  }

  @Get('sessions/:sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
  ): ReturnType<ChatService['getSession']> {
    return this.chatService.getSession(sessionId);
  }

  @Patch('sessions/:sessionId')
  async updateSession(
    @Param('sessionId') sessionId: string,
    @Body() body: UpdateSessionDto,
  ): ReturnType<ChatService['updateSession']> {
    return this.chatService.updateSession(sessionId, body);
  }

  @Delete('sessions/:sessionId')
  async deleteSession(
    @Param('sessionId') sessionId: string,
  ): ReturnType<ChatService['deleteSession']> {
    return this.chatService.deleteSession(sessionId);
  }

  // The turn actions (send / retry / confirm-tool / cancel-tool) are NOT HTTP
  // endpoints — chat is a core plugin and runs its turns over the realtime
  // socket (#61: CHAT_SEND_COMMAND & co., registered in ChatModule). Their
  // stages + final reply stream back into the `chat-session:<id>` room.
}
