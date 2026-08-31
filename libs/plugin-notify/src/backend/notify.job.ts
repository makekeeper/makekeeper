import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { getErrorMessage } from '@makekeeper/backend-core';
import { NotifyDeliveryService } from './delivery.service';
import { NotifyActionsService } from './notify-actions.service';

// The delivery clock (#311). One minute, like the scheduler's: a notification
// held by quiet hours or a retry is not urgent by definition, and a channel
// that is down does not become reachable faster for being asked more often.
@Injectable()
export class NotifyJob {
  private readonly logger = new Logger(NotifyJob.name);
  private draining = false;

  constructor(
    private readonly delivery: NotifyDeliveryService,
    private readonly actions: NotifyActionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async drain(): Promise<void> {
    // A pass that outlasts its minute must not be joined by the next: two
    // drains over the same delivery row would send it twice.
    if (this.draining) return;
    this.draining = true;
    try {
      await this.delivery.drain(new Date());
    } catch (err) {
      this.logger.error(`Delivery drain failed: ${getErrorMessage(err)}`);
    } finally {
      this.draining = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    try {
      await this.actions.purgeExpired(new Date());
    } catch (err) {
      this.logger.warn(`Action-token purge failed: ${getErrorMessage(err)}`);
    }
  }
}
