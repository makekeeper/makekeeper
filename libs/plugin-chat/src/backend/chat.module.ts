import { Module, OnModuleInit } from '@nestjs/common';
import {
  PrismaModule,
  AgentRegistryModule,
  AttachmentStorageModule,
  PluginRegistryService,
  AgentRegistryService,
  PluginI18nService,
  StatsRegistryService,
  CapabilityRegistryService,
  RealtimeService,
  validateRealtimeData,
  ExchangeRegistryService,
  AttachmentStorageService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  CHAT_CANCEL_TOOL_COMMAND,
  CHAT_CONFIRM_TOOL_COMMAND,
  CHAT_RETRY_COMMAND,
  CHAT_SEND_COMMAND,
  TEXT_COMPLETION_CAPABILITY,
  VISION_COMPLETION_CAPABILITY,
} from '@makekeeper/plugin-contract';
import { chatManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import {
  ChatCancelToolCommandDto,
  ChatConfirmToolCommandDto,
  ChatRetryCommandDto,
  ChatSendCommandDto,
} from './chat.dto';
import { ProvidersController } from './providers.controller';
import { ProviderService } from './providers.service';
import { AttachmentSettingsController } from './attachment-settings.controller';
import { AttachmentSettingsService } from './attachment-settings.service';
import { LlmClient } from './llm-client';
import { ChatAnalyticsService } from './chat-analytics.service';
import { getChatTools } from './chat.tools';
import { createChatExchangeProviders } from './chat.exchange';
import { createTableDumpProvider } from '@makekeeper/backend-core';

@Module({
  imports: [PrismaModule, AgentRegistryModule, AttachmentStorageModule],
  controllers: [
    ChatController,
    ProvidersController,
    AttachmentSettingsController,
  ],
  providers: [
    ChatService,
    ProviderService,
    LlmClient,
    ChatAnalyticsService,
    AttachmentSettingsService,
  ],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly providerService: ProviderService,
    private readonly i18n: PluginI18nService,
    private readonly statsRegistry: StatsRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly chatService: ChatService,
    private readonly chatAnalytics: ChatAnalyticsService,
    private readonly realtime: RealtimeService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly attachments: AttachmentStorageService,
    private readonly prisma: PrismaService,
    private readonly attachmentSettings: AttachmentSettingsService,
  ) {}

  onModuleInit() {
    this.registry.register(chatManifest);
    this.i18n.registerBundle({ en, ru });
    // Exchange section provider (#62): the project root's AI chat history.
    for (const provider of createChatExchangeProviders(
      this.prisma,
      this.attachments,
    )) {
      this.exchangeRegistry.registerSectionProvider('chat', provider);
    }
    // Instance backup: chat tables + (secrets-gated) provider connections.
    this.exchangeRegistry.registerSectionProvider(
      'chat',
      createTableDumpProvider({
        sectionKey: 'chat.all',
        models: ['aIChatSession', 'aIChatMessage', 'aIUsageEvent'],
        prisma: this.prisma,
      }),
    );
    this.exchangeRegistry.registerSectionProvider(
      'chat',
      createTableDumpProvider({
        sectionKey: 'chat.providers',
        models: ['aIProviderConfig'],
        prisma: this.prisma,
      }),
    );
    // Live agent-turn stages (#61): clients join their session's room to see
    // "model thinking / tool running" progress while the HTTP turn is in flight.
    this.realtime.registerRoomAuthorizer(
      chatManifest.id,
      'chat-session',
      (userId, room) => this.chatService.authorizeRealtimeRoom(userId, room),
    );
    // Client → server chat turns over the socket (#61) — the sole turn transport
    // (session CRUD/read stays on ChatController). The gateway has already
    // established the caller's request context (scope/locale) before dispatch,
    // so these handlers scope exactly like the HTTP controller. Each turn streams
    // its stages + final reply back over the session room; the ack only reports
    // acceptance. `validateRealtimeData` runs the payload through the command's
    // DTO (§5.2) — the generic gateway can't, since `data` is per-command.
    this.realtime.registerCommand(
      chatManifest.id,
      CHAT_SEND_COMMAND,
      async (ctx, data) => {
        const d = validateRealtimeData(ChatSendCommandDto, data);
        await this.chatService.sendMessage(
          d.sessionId,
          d.message,
          d.images,
          d.pageContext,
          ctx.locale,
          d.projectId ?? null,
        );
        return { ok: true };
      },
    );
    this.realtime.registerCommand(
      chatManifest.id,
      CHAT_CONFIRM_TOOL_COMMAND,
      async (ctx, data) => {
        const d = validateRealtimeData(ChatConfirmToolCommandDto, data);
        await this.chatService.confirmTool(
          d.sessionId,
          d.messageId,
          d.toolName,
          d.args,
          ctx.locale,
        );
        return { ok: true };
      },
    );
    this.realtime.registerCommand(
      chatManifest.id,
      CHAT_CANCEL_TOOL_COMMAND,
      async (ctx, data) => {
        const d = validateRealtimeData(ChatCancelToolCommandDto, data);
        await this.chatService.cancelTool(d.sessionId, d.messageId, ctx.locale);
        return { ok: true };
      },
    );
    this.realtime.registerCommand(
      chatManifest.id,
      CHAT_RETRY_COMMAND,
      async (ctx, data) => {
        const d = validateRealtimeData(ChatRetryCommandDto, data);
        await this.chatService.retryTurn(d.sessionId, ctx.locale);
        return { ok: true };
      },
    );
    // One-shot vision completion for other plugins (logistics screenshot-import)
    // — offered as a capability (#58) so consumers never import chat's code and
    // it vanishes while chat is disabled. ChatService structurally satisfies
    // the contract's VisionCompletionCapability.
    this.capabilities.registerCapability(
      'chat',
      VISION_COMPLETION_CAPABILITY,
      this.chatService,
    );
    // Its text-only sibling (#206), registered separately so a consumer that
    // needs one is not handed the other.
    this.capabilities.registerCapability(
      'chat',
      TEXT_COMPLETION_CAPABILITY,
      this.chatService,
    );
    this.agentRegistry.registerTools(
      getChatTools(
        this.providerService,
        this.agentRegistry,
        this.attachments,
        this.attachmentSettings,
        this.i18n,
      ),
    );
    // Pilot stats provider (ticket #56): daily human-message counts feed the
    // `chat.messages` metric the stats plugin aggregates and serves.
    this.statsRegistry.registerStatsProvider('chat', 'chat.messages', {
      fetchRange: (from, to) =>
        this.chatAnalytics.getMessageCountsByDayScope(from, to),
    });
    // Provider-usage telemetry (ticket #55): requests / tokens / errors per day,
    // dimensioned by provider+model, derived from AIUsageEvent.
    this.statsRegistry.registerStatsProvider('chat', 'chat.usage.requests', {
      fetchRange: (from, to) =>
        this.chatAnalytics.getUsageCountsByDayScope(from, to, 'requests'),
    });
    this.statsRegistry.registerStatsProvider('chat', 'chat.usage.tokens', {
      fetchRange: (from, to) =>
        this.chatAnalytics.getUsageCountsByDayScope(from, to, 'tokens'),
    });
    this.statsRegistry.registerStatsProvider('chat', 'chat.usage.errors', {
      fetchRange: (from, to) =>
        this.chatAnalytics.getUsageCountsByDayScope(from, to, 'errors'),
    });
  }
}
