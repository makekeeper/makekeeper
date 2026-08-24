import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, getErrorMessage } from '@makekeeper/backend-core';
import {
  PhoneBridgeSettingsPublic,
  TunnelMode,
} from '@makekeeper/plugin-contract';
import {
  DEFAULT_IDLE_TTL_MINUTES,
  DEFAULT_TUNNEL_MODE,
  PHONE_BRIDGE_SETTINGS_ID as SETTINGS_ID,
} from './phone-bridge-settings.constants';

// The phone-bridge plugin's own persisted settings — a single row (id "default")
// holding the Cloudflare-tunnel mode and an optional binary-path override.
// Cached in memory; the DB is only touched on read-through and writes.

const TUNNEL_MODES: readonly TunnelMode[] = ['off', 'on', 'auto'];

const isTunnelMode = (value: string): value is TunnelMode =>
  (TUNNEL_MODES as readonly string[]).includes(value);

@Injectable()
export class PhoneBridgeSettingsService {
  private readonly logger = new Logger(PhoneBridgeSettingsService.name);
  private cache: PhoneBridgeSettingsPublic | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PhoneBridgeSettingsPublic> {
    if (this.cache) return this.cache;
    try {
      const row = await this.prisma.phoneBridgeSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      this.cache = {
        tunnelMode:
          row && isTunnelMode(row.tunnelMode)
            ? row.tunnelMode
            : DEFAULT_TUNNEL_MODE,
        cloudflaredPath: row?.cloudflaredPath ?? null,
        tunnelIdleTtlMinutes:
          row?.tunnelIdleTtlMinutes ?? DEFAULT_IDLE_TTL_MINUTES,
      };
    } catch (err) {
      this.logger.error(
        `Failed to load phone-bridge settings: ${getErrorMessage(err)}`,
      );
      this.cache = {
        tunnelMode: DEFAULT_TUNNEL_MODE,
        cloudflaredPath: null,
        tunnelIdleTtlMinutes: DEFAULT_IDLE_TTL_MINUTES,
      };
    }
    return this.cache;
  }

  async getMode(): Promise<TunnelMode> {
    return (await this.get()).tunnelMode;
  }

  async getBinaryPath(): Promise<string | null> {
    return (await this.get()).cloudflaredPath;
  }

  async getIdleTtlMinutes(): Promise<number> {
    return (await this.get()).tunnelIdleTtlMinutes;
  }

  async update(
    patch: Partial<PhoneBridgeSettingsPublic>,
  ): Promise<PhoneBridgeSettingsPublic> {
    const current = await this.get();
    const next: PhoneBridgeSettingsPublic = {
      tunnelMode: patch.tunnelMode ?? current.tunnelMode,
      cloudflaredPath:
        patch.cloudflaredPath !== undefined
          ? patch.cloudflaredPath
          : current.cloudflaredPath,
      tunnelIdleTtlMinutes:
        patch.tunnelIdleTtlMinutes !== undefined
          ? patch.tunnelIdleTtlMinutes
          : current.tunnelIdleTtlMinutes,
    };
    await this.prisma.phoneBridgeSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        tunnelMode: next.tunnelMode,
        cloudflaredPath: next.cloudflaredPath,
        tunnelIdleTtlMinutes: next.tunnelIdleTtlMinutes,
      },
      update: {
        tunnelMode: next.tunnelMode,
        cloudflaredPath: next.cloudflaredPath,
        tunnelIdleTtlMinutes: next.tunnelIdleTtlMinutes,
      },
    });
    this.cache = next;
    return next;
  }
}
