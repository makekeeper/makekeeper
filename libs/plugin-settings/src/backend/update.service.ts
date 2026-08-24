import { Injectable, Logger } from '@nestjs/common';
import {
  AppConfigService,
  PrismaService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  PRODUCT_SLUG,
  UpdateCheckSettings,
  UpdateCheckState,
  UpdateCheckStatus,
} from '@makekeeper/plugin-contract';
import { highestSemver, isNewerVersion } from './update-semver';

const SETTINGS_ID = 'default';
const FETCH_TIMEOUT_MS = 8_000;
// Auto-check runs at most once per ~day; the hourly cron re-checks this guard so a
// restart within the window doesn't re-fire.
const MIN_AUTO_INTERVAL_MS = 23 * 60 * 60 * 1000;

interface GithubTag {
  name: string;
}

@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async getState(): Promise<UpdateCheckState> {
    // Resilient: a failed read (e.g. the migration hasn't run yet) must not blank
    // the settings page or the sidebar version — fall back to config + defaults.
    let row: Awaited<
      ReturnType<typeof this.prisma.updateCheckSettings.findUnique>
    > = null;
    try {
      row = await this.prisma.updateCheckSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
    } catch (err) {
      this.logger.warn(
        `Update-check state read failed: ${getErrorMessage(err)}`,
      );
    }
    const currentVersion = this.config.getAppVersion();
    const latestVersion = row?.latestVersion ?? null;
    return {
      autoCheckEnabled: row?.autoCheckEnabled ?? false,
      checkHourUtc: row?.checkHourUtc ?? 3,
      currentVersion,
      latestVersion,
      updateAvailable:
        latestVersion !== null && isNewerVersion(latestVersion, currentVersion),
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastCheckStatus: this.normalizeStatus(row?.lastCheckStatus),
      releaseUrl: row?.releaseUrl ?? null,
    };
  }

  async updateSettings(
    patch: Partial<UpdateCheckSettings>,
  ): Promise<UpdateCheckState> {
    await this.prisma.updateCheckSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        autoCheckEnabled: patch.autoCheckEnabled ?? false,
        checkHourUtc: patch.checkHourUtc ?? 3,
      },
      update: {
        autoCheckEnabled: patch.autoCheckEnabled,
        checkHourUtc: patch.checkHourUtc,
      },
    });
    return this.getState();
  }

  // Query the source for the latest release tag and cache the result. Never
  // throws — a network/HTTP failure is recorded as `unreachable` so the UI can
  // say "couldn't check" rather than error out.
  async checkNow(): Promise<UpdateCheckState> {
    const now = new Date();
    let latestTag: string | null = null;
    let status: UpdateCheckStatus = 'unreachable';
    try {
      latestTag = await this.fetchLatestTag();
      status = 'ok';
    } catch (err) {
      this.logger.warn(`Update check failed: ${getErrorMessage(err)}`);
    }

    const repo = this.config.getUpdateCheckRepo();
    // On a reachable check, cache the tag + its release page; on failure, keep the
    // previously known values and only record the attempt.
    const data =
      status === 'ok'
        ? {
            latestVersion: latestTag,
            releaseUrl: latestTag
              ? `https://github.com/${repo}/releases/tag/${latestTag}`
              : null,
            lastCheckedAt: now,
            lastCheckStatus: status,
          }
        : { lastCheckedAt: now, lastCheckStatus: status };

    await this.prisma.updateCheckSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return this.getState();
  }

  // Called hourly by the cron. Runs a check only when auto-check is on, it's the
  // configured UTC hour, and we haven't checked in the last ~day.
  async maybeAutoCheck(nowUtcHour: number, nowMs: number): Promise<void> {
    const row = await this.prisma.updateCheckSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (!row?.autoCheckEnabled) return;
    if (row.checkHourUtc !== nowUtcHour) return;
    const lastMs = row.lastCheckedAt?.getTime() ?? 0;
    if (nowMs - lastMs < MIN_AUTO_INTERVAL_MS) return;
    this.logger.log(`Running scheduled update check (hour ${nowUtcHour} UTC).`);
    await this.checkNow();
  }

  private async fetchLatestTag(): Promise<string | null> {
    const repo = this.config.getUpdateCheckRepo();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/tags?per_page=100`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            // GitHub rejects requests without a User-Agent.
            'User-Agent': `${PRODUCT_SLUG}-update-checker`,
          },
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        throw new Error(`GitHub tags request returned ${res.status}`);
      }
      const tags = (await res.json()) as GithubTag[];
      return highestSemver(tags.map((t) => t.name));
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeStatus(value: string | undefined): UpdateCheckStatus {
    return value === 'ok' || value === 'unreachable' ? value : 'never';
  }
}
