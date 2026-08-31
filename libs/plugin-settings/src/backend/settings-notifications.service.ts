import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CapabilityRegistryService,
  DiskUsageService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  NOTIFY_BUS_CAPABILITY,
  type NotificationTypeDeclaration,
  type NotifyBusCapability,
  type UpdateCheckState,
} from '@makekeeper/plugin-contract';

// The first emitter on the notification bus (#307). Both facts here are found
// by a cron with nobody present — which is the case a notification exists for:
// an admin who never opens Settings → Update has no other way to learn that a
// release is out, and the disk fills up quietly by design.
export const SETTINGS_NOTIFICATION_TYPES: NotificationTypeDeclaration[] = [
  {
    type: 'settings.update-available',
    labelKey: 'settings.notifications.updateAvailable.label',
    defaultImportance: 'normal',
  },
  {
    type: 'settings.disk-reclaimable',
    labelKey: 'settings.notifications.diskReclaimable.label',
    defaultImportance: 'low',
  },
];

// Bytes of purgeable orphans worth telling somebody about. Below this the sweep
// would free less than a phone photo, and a notification about it is noise.
const DISK_NOTICE_THRESHOLD_BYTES = 256 * 1024 * 1024;

const MIB = 1024 * 1024;

@Injectable()
export class SettingsNotificationsService {
  private readonly logger = new Logger(SettingsNotificationsService.name);

  constructor(
    private readonly capabilities: CapabilityRegistryService,
    private readonly disk: DiskUsageService,
  ) {}

  // Resolved per call, never cached: `null` means notify is absent or disabled,
  // and the caller simply carries on (§5.10).
  private get bus(): NotifyBusCapability | null {
    return this.capabilities.getCapability<NotifyBusCapability>(
      NOTIFY_BUS_CAPABILITY,
    );
  }

  declareTypes(): void {
    this.bus?.declareTypes('settings', SETTINGS_NOTIFICATION_TYPES);
  }

  // Called after every update check, automatic or manual. The dedup key is the
  // version, so a daily poll that keeps finding 0.14.0 keeps ONE unread row —
  // and a later 0.15.0 is a new fact and gets its own.
  async announceUpdate(state: UpdateCheckState): Promise<void> {
    if (!state.updateAvailable || !state.latestVersion) return;
    try {
      await this.bus?.post({
        type: 'settings.update-available',
        target: { kind: 'audience', audience: 'admins' },
        titleKey: 'settings.notifications.updateAvailable.title',
        bodyKey: 'settings.notifications.updateAvailable.body',
        params: {
          version: state.latestVersion,
          current: state.currentVersion,
        },
        dedupKey: `settings.update:${state.latestVersion}`,
        actions: [{ kind: 'dismiss' }],
      });
    } catch (err) {
      this.logger.warn(
        `Announcing an available update failed: ${getErrorMessage(err)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkDiskDaily(): Promise<void> {
    try {
      const report = await this.disk.report();
      const bytes = report.unreferencedPurgeable.bytes;
      if (bytes < DISK_NOTICE_THRESHOLD_BYTES) return;
      await this.bus?.post({
        type: 'settings.disk-reclaimable',
        target: { kind: 'audience', audience: 'admins' },
        titleKey: 'settings.notifications.diskReclaimable.title',
        bodyKey: 'settings.notifications.diskReclaimable.body',
        // Rounded to whole MiB so a few bytes of drift do not read as a change
        // when the same notice is refreshed tomorrow.
        params: { megabytes: Math.round(bytes / MIB) },
        // One standing "there is something to sweep" row, refreshed daily
        // rather than one row per day until somebody looks.
        dedupKey: 'settings.disk-reclaimable',
        actions: [{ kind: 'dismiss' }],
      });
    } catch (err) {
      this.logger.warn(`Daily disk check failed: ${getErrorMessage(err)}`);
    }
  }
}
