import { Injectable, Logger } from '@nestjs/common';
import {
  AppConfigService,
  CapabilityRegistryService,
  PrismaService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  PHONE_BRIDGE_TUNNEL_CAPABILITY,
  type MobileSettingsPublic,
  type PhoneBridgeTunnelCapability,
} from '@makekeeper/plugin-contract';
import {
  CUSTOM_ORIGIN_MAX_LENGTH,
  MOBILE_SETTINGS_ID,
} from './mobile-settings.constants';

// Where the mobile surface is published. A singleton row, read through an
// in-memory cache — the same shape phone-bridge uses for its own settings.

// What the stored row holds. Everything else in `MobileSettingsPublic` is
// derived per request (env overrides), never persisted.
interface StoredSettings {
  customOrigin: string | null;
}

@Injectable()
export class MobileSettingsService {
  private readonly logger = new Logger(MobileSettingsService.name);
  private cache: StoredSettings | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  private defaults(): StoredSettings {
    return { customOrigin: null };
  }

  async getStored(): Promise<StoredSettings> {
    if (this.cache) return this.cache;
    try {
      const row = await this.prisma.mobileSettings.findUnique({
        where: { id: MOBILE_SETTINGS_ID },
      });
      this.cache = row ? { customOrigin: row.customOrigin } : this.defaults();
    } catch (err) {
      // A settings table that cannot be read must not take the surface down
      // with it; the defaults are the safe answer (no configured address).
      this.logger.warn(`Falling back to defaults: ${getErrorMessage(err)}`);
      this.cache = this.defaults();
    }
    return this.cache;
  }

  // Resolved per call (#5.10): null means phone-bridge is disabled or absent, so
  // there is no tunnel to be had.
  tunnel(): PhoneBridgeTunnelCapability | null {
    return this.capabilities.getCapability<PhoneBridgeTunnelCapability>(
      PHONE_BRIDGE_TUNNEL_CAPABILITY,
    );
  }

  async getPublic(): Promise<MobileSettingsPublic> {
    const stored = await this.getStored();
    return {
      customOrigin: stored.customOrigin,
      originEnvOverride: this.config.getMobileOriginOverride(),
      sessionCookieDomain: this.config.getSessionCookieDomain(),
    };
  }

  async update(patch: {
    customOrigin?: string | null;
  }): Promise<MobileSettingsPublic> {
    const current = await this.getStored();
    const next: StoredSettings = {
      customOrigin:
        patch.customOrigin === undefined
          ? current.customOrigin
          : normalizeOrigin(patch.customOrigin),
    };

    await this.prisma.mobileSettings.upsert({
      where: { id: MOBILE_SETTINGS_ID },
      create: { id: MOBILE_SETTINGS_ID, ...next },
      update: next,
    });
    this.cache = next;
    return this.getPublic();
  }
}

// An origin, or null. Trailing slashes and empty strings are the two things
// people actually type; anything that is not an absolute http(s) origin is
// rejected by the DTO before it reaches here.
function normalizeOrigin(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  return trimmed.replace(/\/+$/, '').slice(0, CUSTOM_ORIGIN_MAX_LENGTH);
}
