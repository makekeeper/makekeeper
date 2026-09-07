import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import {
  AppConfigService,
  DEFAULT_LOCALE,
  InstallInfoService,
  PluginConfigService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  isTelemetryConsent,
  isTelemetryStatus,
  TELEMETRY_PENDING_ID,
  TELEMETRY_PING_INTERVAL_HOURS,
  type TelemetryPayload,
  type TelemetryState,
  type TelemetryStatus,
} from '@makekeeper/plugin-contract';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Opt-in liveness telemetry (#343, narrowing the deferred #102).
//
// One question — how many instances are alive at 7 and at 30 days — and the
// smallest machinery that answers it. Three rules this service exists to keep,
// in the order breaking one would hurt:
//
// 1. Nothing leaves an instance whose consent is not `granted`. Not a probe,
//    not an "is the endpoint up" check, not an error report. `send()` is
//    private, the scheduled job's first act is to read consent, and `send()`
//    re-reads it anyway — the last gate before an outbound request is the one
//    that must not have an exception.
// 2. The instance id is minted by the first grant, never on read. An instance
//    that declines has nothing identifying it, not even locally.
// 3. A failure is silent to the operator and cheap to the process: a short
//    timeout, a debug line, and never anything that blocks boot or a request.
//
// The row is a singleton settings row like `UpdateCheckSettings` and
// `DemoDataSettings`, and `unscoped` in the multiuser scope map: consent
// belongs to the installation, not to whoever is signed in.
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly installInfo: InstallInfoService,
    private readonly plugins: PluginConfigService,
  ) {}

  private row() {
    return this.prisma.telemetrySettings.findUnique({
      where: { id: 'default' },
    });
  }

  async getState(): Promise<TelemetryState> {
    const row = await this.row();
    const endpoint = this.config.getTelemetryEndpoint();
    return {
      consent: isTelemetryConsent(row?.consent) ? row.consent : 'unasked',
      instanceId: row?.instanceId ?? null,
      prompted: row?.promptedAt != null,
      lastSentAt: row?.lastSentAt?.toISOString() ?? null,
      lastStatus: isTelemetryStatus(row?.lastStatus) ? row.lastStatus : 'never',
      endpointConfigured: endpoint !== null,
      endpoint,
    };
  }

  /**
   * Record the answer.
   *
   * `granted` mints the id when there is none and remembers the answering
   * user's interface language — the payload's `locale` is that, because an
   * instance has no language of its own (it is resolved per request from
   * `x-locale`), and "the language the operator works in" is the honest reading
   * of the field.
   *
   * `denied` keeps the id: a user who turns the switch off and on again is one
   * install, not two, and inventing a second id would inflate exactly the
   * number this whole feature exists to measure.
   */
  async setConsent(granted: boolean, locale?: string): Promise<TelemetryState> {
    const now = new Date();
    const existing = await this.row();
    const instanceId = existing?.instanceId ?? (granted ? randomUUID() : null);
    const consent = granted ? 'granted' : 'denied';
    await this.prisma.telemetrySettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        consent,
        instanceId,
        locale: granted ? (locale ?? DEFAULT_LOCALE) : null,
        promptedAt: now,
        decidedAt: now,
      },
      update: {
        consent,
        instanceId,
        ...(granted ? { locale: locale ?? DEFAULT_LOCALE } : {}),
        promptedAt: existing?.promptedAt ?? now,
        decidedAt: now,
      },
    });
    // A fresh "yes" reports at once — waiting for the next tick would lose
    // precisely the installs that do not survive their first day, the ones the
    // survival curve is most interested in.
    //
    // But it is NOT awaited. An instance with no route out sits in the ten
    // second timeout, and awaiting it held the switch in the UI for all ten,
    // for a request whose real work — recording the answer — was already done.
    // The answer is the user's; the report is ours, and ours can be late.
    if (granted) void this.sendInBackground();
    return this.getState();
  }

  /**
   * The question has been put to a human.
   *
   * Stored apart from the answer so that closing the dialog is not read as
   * "no": consent stays `unasked` (which sends exactly as much as `denied` —
   * nothing), and the dialog never comes back. "Asked once" is the promise;
   * turning a dismissal into a recorded decision would be a different one.
   */
  async markPrompted(): Promise<TelemetryState> {
    const now = new Date();
    await this.prisma.telemetrySettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', promptedAt: now },
      update: { promptedAt: now },
    });
    return this.getState();
  }

  // Hourly tick, daily send: the schedule has to be finer than the interval, or
  // an instance restarted every evening never reaches its due time. The tick
  // itself is cheap — one indexed read that usually returns "not granted".
  //
  // Paced by the last ATTEMPT, not the last success. Counting from `lastSentAt`
  // meant an instance with no outbound network had nothing to count from and
  // retried every hour forever — a promise of "once a day" that held only for
  // the instances that could reach us in the first place.
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledPing(): Promise<void> {
    const row = await this.row();
    if (row?.consent !== 'granted') return;
    const last = row.lastAttemptAt?.getTime() ?? 0;
    if (Date.now() < last + TELEMETRY_PING_INTERVAL_HOURS * 60 * 60 * 1000) {
      return;
    }
    // Same guard as the request path: nothing is waiting on this tick either,
    // and a rejection escaping a scheduled job has no caller to meet.
    await this.sendInBackground();
  }

  /**
   * What the NEXT report will carry, for the consent dialog and the settings
   * fold to render.
   *
   * The locale is the subtlety: a report sends the language captured when
   * consent was given, not the language of whoever is reading the page. Showing
   * the reader's own language here would put a value on screen that is not the
   * one we send — the preview would be a well-meant lie the moment an admin
   * switched languages after agreeing. So a stored locale wins, and the
   * reader's is used only before there is one.
   */
  async getPreview(requestLocale?: string): Promise<TelemetryPayload> {
    const row = await this.row();
    return this.buildPayload(
      row?.instanceId ?? TELEMETRY_PENDING_ID,
      row?.locale ?? requestLocale,
    );
  }

  /**
   * Everything a ping carries, and nothing else. Public because the consent
   * dialog shows the real thing rather than an example of it: a promise about
   * what is sent is checkable only if the sender renders it.
   */
  async buildPayload(
    instanceId: string,
    locale?: string | null,
  ): Promise<TelemetryPayload> {
    const plugins = this.plugins
      .getStates()
      .filter((state) => state.isEnabled)
      .map((state) => state.pluginId)
      .sort((a, b) => a.localeCompare(b));
    return {
      instanceId,
      version: this.config.getAppVersion(),
      installMethod: this.installInfo.getInstallInfo().method,
      plugins,
      locale: locale ?? DEFAULT_LOCALE,
    };
  }

  /**
   * `send()` detached from a request, with the rule that a floating promise
   * must never be able to reject: an unhandled rejection takes the whole
   * process down, and this one runs with nobody left to catch it.
   *
   * `send()` already swallows transport failures; this guards the rest of it —
   * the database write at the end included.
   */
  private async sendInBackground(): Promise<void> {
    try {
      await this.send();
    } catch (err) {
      this.logger.debug(`Liveness ping abandoned: ${getErrorMessage(err)}`);
    }
  }

  private async send(): Promise<void> {
    const endpoint = this.config.getTelemetryEndpoint();
    const row = await this.row();
    if (endpoint === null || row?.consent !== 'granted' || !row.instanceId) {
      return;
    }

    let status: TelemetryStatus = 'unreachable';
    try {
      const payload = await this.buildPayload(row.instanceId, row.locale);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) status = 'ok';
      else this.logger.debug(`Liveness ping rejected: ${response.status}`);
    } catch (err) {
      // Debug, not warn: an instance with no outbound network is a perfectly
      // normal instance, and a daily warning about it is noise its operator
      // cannot act on.
      this.logger.debug(`Liveness ping failed: ${getErrorMessage(err)}`);
    }

    // The attempt is recorded whatever came of it; only a success moves
    // `lastSentAt`, which is what the UI shows as "last reported".
    const now = new Date();
    await this.prisma.telemetrySettings.update({
      where: { id: 'default' },
      data: {
        lastStatus: status,
        lastAttemptAt: now,
        ...(status === 'ok' ? { lastSentAt: now } : {}),
      },
    });
  }
}
