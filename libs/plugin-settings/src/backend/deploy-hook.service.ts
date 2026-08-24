import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PluginI18nService,
  PrismaService,
  SecretBoxService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  DeployHookMethod,
  DeployHookOutcome,
  DeployHookSettingsPatch,
  DeployHookState,
  DeployHookTriggerResult,
  isDeployHookMethod,
} from '@makekeeper/plugin-contract';

// The admin-pasted deploy hook (#101): "update now" POSTs (or GETs) the webhook
// of the admin's OWN deployment manager — Coolify, Dokploy, a CI endpoint. The
// app can never discover that URL itself (#97), so configuration is the only
// source of truth and install-method detection stays a setup hint.
//
// Both the URL and the token are secrets: Dokploy's hook embeds a refresh token
// in the path, so a leaked URL is a leaked deploy credential. Both are encrypted
// at rest under the app secret, and neither is ever returned to the client — the
// UI sees `hasUrl` + a scheme/host preview.
//
// The hook RESPONSE BODY is deliberately never read, stored or returned: a
// manager may echo tokens or internal detail into it. Only the status code is
// recorded.

const SETTINGS_ID = 'default';
const TRIGGER_TIMEOUT_MS = 15_000;

@Injectable()
export class DeployHookService {
  private readonly logger = new Logger(DeployHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
    private readonly i18n: PluginI18nService,
  ) {}

  async getState(): Promise<DeployHookState> {
    // Resilient like UpdateService.getState: a failed read (migration not yet
    // applied) must render as "not configured", not blank the settings page.
    try {
      const row = await this.prisma.updateCheckSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      return this.toState(row);
    } catch (err) {
      this.logger.warn(
        `Deploy-hook state read failed: ${getErrorMessage(err)}`,
      );
      return this.toState(null);
    }
  }

  async updateSettings(
    patch: DeployHookSettingsPatch,
    locale?: string,
  ): Promise<DeployHookState> {
    // An empty string clears the field; undefined keeps the stored ciphertext.
    const url = this.normalizeSecret(patch.url, (value) =>
      this.assertValidUrl(value, locale),
    );
    // Clearing the URL dismantles the whole hook: the token is cleared with it
    // (an orphaned bearer token is a live deploy credential that now guards
    // nothing), and a `method` riding along in the same payload is ignored
    // rather than refused — the settings form sends its method with every save,
    // and rejecting the clear because of it made an emptied URL field
    // impossible to save (#270).
    const token = url === null ? null : this.normalizeSecret(patch.token);
    const method: DeployHookMethod | undefined =
      url === null ? undefined : patch.method;

    // A token or a method is meaningless with no URL to send them to. Storing
    // one would report "saved" and then fail at trigger time with "not
    // configured", so refuse a hook that could never fire.
    const stored = await this.prisma.updateCheckSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    const effectiveUrl =
      url === undefined ? (stored?.deployHookUrl ?? null) : url;
    // `token` is a ciphertext only when one is being set — `undefined` leaves it
    // alone and `null` clears it, and neither needs a URL to exist.
    if (!effectiveUrl && (typeof token === 'string' || method !== undefined)) {
      throw new BadRequestException(
        this.i18n.t('settings.errors.deployHookUrlRequired', undefined, locale),
      );
    }

    const data = {
      ...(url === undefined ? {} : { deployHookUrl: url }),
      ...(token === undefined ? {} : { deployHookToken: token }),
      ...(method === undefined ? {} : { deployHookMethod: method }),
    };

    await this.prisma.updateCheckSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return this.getState();
  }

  // Fire the configured hook. Never throws on a transport/HTTP failure — the
  // outcome is recorded and surfaced, so the UI can say "the manager rejected
  // it" instead of erroring out. Only a missing configuration is a 400: that is
  // a caller mistake, not a remote failure.
  async trigger(locale?: string): Promise<DeployHookTriggerResult> {
    const row = await this.prisma.updateCheckSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    const url = row?.deployHookUrl
      ? this.secretBox.decrypt(row.deployHookUrl)
      : null;
    if (!url) {
      throw new BadRequestException(
        this.i18n.t(
          'settings.errors.deployHookNotConfigured',
          undefined,
          locale,
        ),
      );
    }
    const token = row?.deployHookToken
      ? this.secretBox.decrypt(row.deployHookToken)
      : null;

    const { ok, statusCode } = await this.call(
      url,
      this.normalizeMethod(row?.deployHookMethod),
      token,
    );

    // Annotated, not `satisfies` on one branch: the column is a plain string, so
    // only an explicit type here makes BOTH literals fail the build if the union
    // is ever renamed.
    const outcome: DeployHookOutcome = ok ? 'ok' : 'failed';
    const data = {
      hookTriggeredAt: new Date(),
      hookOutcome: outcome,
      hookStatusCode: statusCode,
    };
    await this.prisma.updateCheckSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return { ok, state: await this.getState() };
  }

  private async call(
    url: string,
    method: DeployHookMethod,
    token: string | null,
  ): Promise<{ ok: boolean; statusCode: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!res.ok) {
        // Log the status only — the body may carry secrets (§ the class comment).
        this.logger.warn(`Deploy hook returned HTTP ${res.status}.`);
      }
      return { ok: res.ok, statusCode: res.status };
    } catch (err) {
      this.logger.warn(`Deploy hook request failed: ${getErrorMessage(err)}`);
      return { ok: false, statusCode: null };
    } finally {
      clearTimeout(timer);
    }
  }

  // undefined → leave untouched; '' → clear; otherwise validate + encrypt.
  private normalizeSecret(
    value: string | undefined,
    validate?: (value: string) => void,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return null;
    validate?.(trimmed);
    return this.secretBox.encrypt(trimmed);
  }

  // Only absolute http(s) URLs. The host is deliberately NOT restricted: the
  // manager usually lives on a private address next to this instance, so an
  // SSRF-style blocklist would break the intended use.
  private assertValidUrl(value: string, locale?: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(
        this.i18n.t('settings.errors.deployHookUrlInvalid', undefined, locale),
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        this.i18n.t('settings.errors.deployHookUrlInvalid', undefined, locale),
      );
    }
  }

  private toState(
    row: Awaited<
      ReturnType<typeof this.prisma.updateCheckSettings.findUnique>
    > | null,
  ): DeployHookState {
    const url = row?.deployHookUrl
      ? this.secretBox.decrypt(row.deployHookUrl)
      : null;
    return {
      hasUrl: Boolean(row?.deployHookUrl),
      urlPreview: this.previewUrl(url),
      method: this.normalizeMethod(row?.deployHookMethod),
      hasToken: Boolean(row?.deployHookToken),
      lastTriggeredAt: row?.hookTriggeredAt?.toISOString() ?? null,
      lastOutcome: this.normalizeOutcome(row?.hookOutcome),
      lastStatusCode: row?.hookStatusCode ?? null,
    };
  }

  // Scheme + host only. The path/query hold the credential in Dokploy's hook
  // shape, so they never reach the client — the ellipsis stands in for them.
  private previewUrl(url: string | null): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/…`;
    } catch {
      return null;
    }
  }

  private normalizeMethod(value: string | undefined): DeployHookMethod {
    return isDeployHookMethod(value) ? value : 'POST';
  }

  private normalizeOutcome(value: string | undefined): DeployHookOutcome {
    return value === 'ok' || value === 'failed' ? value : 'never';
  }
}
