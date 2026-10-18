import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { HomeAssistantSettingsPublic } from '../settings-contract';
import {
  PluginI18nService,
  PrismaService,
  SecretBoxService,
  getErrorMessage,
} from '@makekeeper/backend-core';

// The instance's Home Assistant connection — one address, one long-lived token
// (#364). Single row (id "default"), cached in memory, DB touched on
// read-through and on write; the same shape `LogisticsSettingsService` has, for
// the same reason: these are INSTANCE credentials an admin manages, so the
// instance key is the right layer and there is no per-user owner to isolate
// them from.
//
// The token never leaves the backend: the public shape says only whether one is
// set, and the decrypted value is reachable through `getInternal()`, which only
// the client service calls.

const SETTINGS_ID = 'default';

export interface HomeAssistantSettingsInternal
  extends HomeAssistantSettingsPublic {
  token: string | null;
}

const DEFAULTS: HomeAssistantSettingsInternal = {
  baseUrl: null,
  token: null,
  hasToken: false,
};

// What an admin pastes is whatever their browser's address bar held, which is
// an address with a trailing slash about half the time and the `/api` path the
// documentation shows about as often. Both are the same instance, so both are
// accepted and stored in one form — otherwise every request builder downstream
// has to guess whether to add a slash, and `//api/states` is a 404 nobody
// enjoys diagnosing.
export function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // Deliberately NOT checked against a host blocklist: a Home Assistant lives
  // on the LAN next to this instance, exactly like the deploy hook (#101), so
  // the SSRF guard that protects untrusted per-user URLs would block the only
  // addresses that can work here. The route is admin-only, and an admin
  // naming a host is not an attacker.
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${parsed.origin}${path}`;
}

@Injectable()
export class HomeAssistantSettingsService {
  private readonly logger = new Logger(HomeAssistantSettingsService.name);
  private cache: HomeAssistantSettingsInternal | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
    private readonly i18n: PluginI18nService,
  ) {}

  private async load(): Promise<HomeAssistantSettingsInternal> {
    if (this.cache) return this.cache;
    try {
      const row = await this.prisma.homeAssistantSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (!row) {
        this.cache = { ...DEFAULTS };
        return this.cache;
      }
      // A null decrypt (tampered row, key rotated away) is treated as "no
      // token" rather than crashing the settings read: the screen then offers
      // to paste a new one, which is the only way out anyway.
      const token = row.token ? this.secretBox.decrypt(row.token) : null;
      this.cache = {
        baseUrl: row.baseUrl ?? null,
        token,
        hasToken: Boolean(row.token),
      };
    } catch (err) {
      // Deliberately NOT cached. A database that failed once is a database
      // that may answer next time, and caching the fallback would turn one
      // hiccup into "this instance has no Home Assistant" until the next write
      // or restart — with the print row gone from every dialog in between.
      this.logger.error(
        `Failed to load Home Assistant settings: ${getErrorMessage(err)}`,
      );
      return { ...DEFAULTS };
    }
    return this.cache;
  }

  async get(): Promise<HomeAssistantSettingsPublic> {
    const s = await this.load();
    return { baseUrl: s.baseUrl, hasToken: s.hasToken };
  }

  // Synchronous "is there a connection at all", for the capability's own
  // `isConfigured()`: that question is asked while deciding whether a surface
  // exists, so it must not await a database. A cold cache answers no, which
  // is also the right answer for an instance that has never been configured;
  // the client service warms it once at boot.
  isConfiguredSync(): boolean {
    return Boolean(this.cache?.baseUrl && this.cache?.token);
  }

  // Address plus decrypted token — backend-only, for the one service that
  // speaks to Home Assistant.
  async getInternal(): Promise<HomeAssistantSettingsInternal> {
    return this.load();
  }

  async update(patch: {
    baseUrl?: string | null;
    token?: string | null;
  }): Promise<HomeAssistantSettingsPublic> {
    const current = await this.load();

    let baseUrl = current.baseUrl;
    if (patch.baseUrl !== undefined) {
      if (!patch.baseUrl) {
        baseUrl = null;
      } else {
        const normalized = normalizeBaseUrl(patch.baseUrl);
        if (!normalized) {
          throw new BadRequestException(
            this.i18n.t('homeassistant.errors.badUrl'),
          );
        }
        baseUrl = normalized;
      }
    }

    // `undefined` keeps the stored ciphertext (the field is omitted from the
    // update), `null`/`''` clears it, a string re-encrypts. The ONE exception
    // to "empty means clear" in this repo is a secret field, and this is it:
    // the screen sends an empty token to mean "keep the one you have" (#220).
    const encryptedToken =
      patch.token === undefined
        ? undefined
        : patch.token
          ? this.secretBox.encrypt(patch.token)
          : null;

    await this.prisma.homeAssistantSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        baseUrl,
        token: encryptedToken ?? undefined,
      },
      update: {
        baseUrl,
        ...(encryptedToken === undefined ? {} : { token: encryptedToken }),
      },
    });
    this.cache = null;
    return this.get();
  }
}
