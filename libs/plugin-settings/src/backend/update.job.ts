import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { getErrorMessage } from '@makekeeper/backend-core';
import { UpdateService } from './update.service';

// Fires hourly; UpdateService.maybeAutoCheck gates it down to at most one check
// per day at the admin's configured UTC hour.
@Injectable()
export class UpdateJob {
  private readonly logger = new Logger(UpdateJob.name);

  constructor(private readonly updates: UpdateService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHourly(): Promise<void> {
    try {
      await this.updates.maybeAutoCheck(new Date().getUTCHours(), Date.now());
    } catch (err) {
      this.logger.warn(
        `Scheduled update check errored: ${getErrorMessage(err)}`,
      );
    }
  }
}
