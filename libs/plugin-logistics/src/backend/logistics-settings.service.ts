import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  PrismaService,
  SecretBoxService,
  getErrorMessage,
} from '@makekeeper/backend-core';

// The logistics plugin's own persisted settings — a single row (id "default")
// holding the parcel-tracking provider + credentials (instance administration).
// Mirrors PhoneBridgeSettingsService: cached in memory, DB touched on read-through
// and writes. Secrets (API key, account password) never leave the backend — the
// public shape only exposes whether they are set. Both the API key and the
// account password are encrypted at rest under the app secret (SecretBoxService).
// These are INSTANCE credentials (admin-managed), so the instance key is the
// right layer — there is no per-user owner to isolate them from.

const SETTINGS_ID = 'default';

export const TRACKING_PROVIDERS = [
  'none',
  '17track',
  'aftership',
  'trackingmore',
  'ship24',
] as const;
export type TrackingProvider = (typeof TRACKING_PROVIDERS)[number];

export const AUTH_MODES = ['apikey', 'credentials'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

const isProvider = (value: string): value is TrackingProvider =>
  (TRACKING_PROVIDERS as readonly string[]).includes(value);
const isAuthMode = (value: string): value is AuthMode =>
  (AUTH_MODES as readonly string[]).includes(value);

export interface LogisticsSettingsPublic {
  trackingProvider: TrackingProvider;
  authMode: AuthMode;
  autoTrackEnabled: boolean;
  pollIntervalHours: number;
  hasApiKey: boolean;
  hasCredentials: boolean;
  trackingLogin: string | null;
}

interface LogisticsSettingsInternal extends LogisticsSettingsPublic {
  trackingApiKey: string | null;
  trackingPassword: string | null;
}

const DEFAULTS: LogisticsSettingsInternal = {
  trackingProvider: 'none',
  authMode: 'apikey',
  trackingApiKey: null,
  trackingLogin: null,
  trackingPassword: null,
  autoTrackEnabled: false,
  pollIntervalHours: 6,
  hasApiKey: false,
  hasCredentials: false,
};

@Injectable()
export class LogisticsSettingsService implements OnModuleInit {
  private readonly logger = new Logger(LogisticsSettingsService.name);
  private cache: LogisticsSettingsInternal | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
  ) {}

  // One-time migration of legacy plaintext secrets to ciphertext at rest. Rows
  // predating #63 hold the API key (and possibly a pre-existing password) in the
  // clear; encrypt them in place on boot. Idempotent — already-encrypted values
  // are skipped via SecretBoxService.isEncrypted.
  async onModuleInit(): Promise<void> {
    try {
      const row = await this.prisma.logisticsSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (!row) return;
      const patch: { trackingApiKey?: string; trackingPassword?: string } = {};
      if (
        row.trackingApiKey &&
        !this.secretBox.isEncrypted(row.trackingApiKey)
      ) {
        patch.trackingApiKey = this.secretBox.encrypt(row.trackingApiKey);
      }
      if (
        row.trackingPassword &&
        !this.secretBox.isEncrypted(row.trackingPassword)
      ) {
        patch.trackingPassword = this.secretBox.encrypt(row.trackingPassword);
      }
      if (Object.keys(patch).length > 0) {
        await this.prisma.logisticsSettings.update({
          where: { id: SETTINGS_ID },
          data: patch,
        });
        this.logger.log(
          `Encrypted ${Object.keys(patch).length} legacy plaintext logistics secret(s) at rest.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Logistics secret migration failed: ${getErrorMessage(err)}`,
      );
    }
  }

  private async load(): Promise<LogisticsSettingsInternal> {
    if (this.cache) return this.cache;
    try {
      const row = await this.prisma.logisticsSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (!row) {
        this.cache = { ...DEFAULTS };
        return this.cache;
      }
      // Decrypt both secrets for backend use. A null (tamper/format) result is
      // treated as "unusable" rather than crashing the whole settings read.
      const apiKey = row.trackingApiKey
        ? this.secretBox.decrypt(row.trackingApiKey)
        : null;
      const password = row.trackingPassword
        ? this.secretBox.decrypt(row.trackingPassword)
        : null;
      this.cache = {
        trackingProvider: isProvider(row.trackingProvider)
          ? row.trackingProvider
          : 'none',
        authMode: isAuthMode(row.authMode) ? row.authMode : 'apikey',
        trackingApiKey: apiKey,
        trackingLogin: row.trackingLogin ?? null,
        trackingPassword: password,
        autoTrackEnabled: row.autoTrackEnabled,
        pollIntervalHours: row.pollIntervalHours,
        hasApiKey: Boolean(row.trackingApiKey),
        hasCredentials: Boolean(row.trackingLogin && row.trackingPassword),
      };
    } catch (err) {
      this.logger.error(
        `Failed to load logistics settings: ${getErrorMessage(err)}`,
      );
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }

  async get(): Promise<LogisticsSettingsPublic> {
    const s = await this.load();
    return {
      trackingProvider: s.trackingProvider,
      authMode: s.authMode,
      autoTrackEnabled: s.autoTrackEnabled,
      pollIntervalHours: s.pollIntervalHours,
      hasApiKey: s.hasApiKey,
      hasCredentials: s.hasCredentials,
      trackingLogin: s.trackingLogin,
    };
  }

  // Full record incl. decrypted secrets — backend-only (the poll/refresh path).
  async getInternal(): Promise<LogisticsSettingsInternal> {
    return this.load();
  }

  async update(patch: {
    trackingProvider?: TrackingProvider;
    authMode?: AuthMode;
    trackingApiKey?: string | null;
    trackingLogin?: string | null;
    trackingPassword?: string | null;
    autoTrackEnabled?: boolean;
    pollIntervalHours?: number;
  }): Promise<LogisticsSettingsPublic> {
    const current = await this.load();

    // Encrypt a newly-supplied secret; undefined keeps the stored ciphertext
    // (the update branch simply omits the field), null/'' clears it.
    // SecretBoxService guarantees the app secret exists (the boot aborts
    // otherwise), so encryption never silently degrades to plaintext.
    const encryptField = (
      value: string | null | undefined,
    ): string | null | undefined => {
      if (value === undefined) return undefined;
      if (!value) return null;
      return this.secretBox.encrypt(value);
    };
    const encryptedApiKey = encryptField(patch.trackingApiKey);
    const encryptedPassword = encryptField(patch.trackingPassword);

    await this.prisma.logisticsSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        trackingProvider: patch.trackingProvider ?? current.trackingProvider,
        authMode: patch.authMode ?? current.authMode,
        trackingApiKey: encryptedApiKey ?? undefined,
        trackingLogin:
          patch.trackingLogin !== undefined
            ? patch.trackingLogin || null
            : current.trackingLogin,
        trackingPassword: encryptedPassword ?? undefined,
        autoTrackEnabled: patch.autoTrackEnabled ?? current.autoTrackEnabled,
        pollIntervalHours: patch.pollIntervalHours ?? current.pollIntervalHours,
      },
      update: {
        trackingProvider: patch.trackingProvider ?? current.trackingProvider,
        authMode: patch.authMode ?? current.authMode,
        ...(encryptedApiKey === undefined
          ? {}
          : { trackingApiKey: encryptedApiKey }),
        trackingLogin:
          patch.trackingLogin !== undefined
            ? patch.trackingLogin || null
            : current.trackingLogin,
        ...(encryptedPassword === undefined
          ? {}
          : { trackingPassword: encryptedPassword }),
        autoTrackEnabled: patch.autoTrackEnabled ?? current.autoTrackEnabled,
        pollIntervalHours: patch.pollIntervalHours ?? current.pollIntervalHours,
      },
    });
    // Invalidate cache; next read re-decrypts.
    this.cache = null;
    return this.get();
  }
}
