import { Module, OnModuleInit } from '@nestjs/common';
import {
  AttachmentStorageModule,
  PrismaModule,
  AgentRegistryModule,
  PluginRegistryService,
  AgentRegistryService,
  PluginI18nService,
  RealtimeService,
  ExchangeRegistryService,
  CapabilityRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  PHONE_BRIDGE_SESSION_CAPABILITY,
  PHONE_BRIDGE_TUNNEL_CAPABILITY,
  REALTIME_GUEST_AUTH_CAPABILITY,
  type PhoneBridgeSessionCapability,
  type PhoneBridgeTunnelCapability,
  type RealtimeGuestAuthCapability,
} from '@makekeeper/plugin-contract';
import { phoneBridgeManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { PhoneBridgeController } from './phone-bridge.controller';
import { PhoneBridgeService } from './phone-bridge.service';
import { PhoneBridgeSettingsService } from './phone-bridge-settings.service';
import { CfTunnelService } from './cf-tunnel.service';
import { getPhoneBridgeTools } from './phone-bridge.tools';
import { createPhoneBridgeExchangeProviders } from './phone-bridge.exchange';

@Module({
  // AttachmentStorageModule for UploadsReservationService: the tunnel binary
  // lives under the uploads root, and the storage page must know whose it is.
  imports: [PrismaModule, AgentRegistryModule, AttachmentStorageModule],
  controllers: [PhoneBridgeController],
  providers: [PhoneBridgeService, PhoneBridgeSettingsService, CfTunnelService],
})
export class PhoneBridgePluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly tunnel: CfTunnelService,
    private readonly i18n: PluginI18nService,
    private readonly realtime: RealtimeService,
    private readonly bridge: PhoneBridgeService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(phoneBridgeManifest);
    this.i18n.registerBundle({ en, ru });
    // Session-liveness capability (#74): lets a consumer with a phone-facing
    // public endpoint gate it on the phone's bridge token. Owner-registered, so
    // it disappears with the plugin and consumers fail closed.
    this.capabilities.registerCapability<PhoneBridgeSessionCapability>(
      'phone-bridge',
      PHONE_BRIDGE_SESSION_CAPABILITY,
      this.bridge,
    );
    // The tunnel, offered to whoever needs a phone-reachable address (#198).
    // The mobile plugin consumes it: on an instance with no permanent HTTPS the
    // tunnel is the only way a phone reaches the surface at all. Owner-
    // registered, so with this plugin disabled there is simply no tunnel to be
    // had — and phone-bridge never learns who is asking.
    this.capabilities.registerCapability<PhoneBridgeTunnelCapability>(
      'phone-bridge',
      PHONE_BRIDGE_TUNNEL_CAPABILITY,
      {
        tunnelUsable: async () => {
          const status = await this.tunnel.getStatus();
          return status.mode !== 'off' && status.binaryPresent;
        },
        currentTunnelUrl: async () =>
          (await this.tunnel.getStatus()).url ?? null,
        touch: () => this.tunnel.markUsed(),
        ensureTunnel: async () => {
          const { url, freshlyStarted } = await this.tunnel.ensureForCapture();
          return { url: url ?? null, freshlyStarted };
        },
      },
    );
    // Instance backup (#62): the tunnel settings singleton.
    for (const provider of createPhoneBridgeExchangeProviders(this.prisma)) {
      this.exchangeRegistry.registerSectionProvider('phone-bridge', provider);
    }
    this.agentRegistry.registerTools(getPhoneBridgeTools(this.tunnel));
    // Guest realtime credential (#79): the paired phone has no user account, so
    // the gateway lets it listen — and ONLY listen — on the room its own session
    // token names. Owner-registered: with the bridge disabled there are no
    // guests at all.
    this.capabilities.registerCapability<RealtimeGuestAuthCapability>(
      'phone-bridge',
      REALTIME_GUEST_AUTH_CAPABILITY,
      {
        resolveGuestRoom: (credential) =>
          this.bridge.resolveGuestRoom(credential),
      },
    );
    this.realtime.registerRoomAuthorizer(
      phoneBridgeManifest.id,
      'phone-bridge',
      (userId, room) => this.bridge.authorizeRealtimeRoom(userId, room),
    );
  }
}
