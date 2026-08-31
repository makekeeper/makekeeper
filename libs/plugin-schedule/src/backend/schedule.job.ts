import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CapabilityRegistryService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  SCHEDULE_TICK_ENGINE_CAPABILITY,
  type ScheduleTickEngineCapability,
} from '@makekeeper/plugin-contract';
import { ScheduleService } from './schedule.service';

// The default clock: one minute tick reading `nextRunAt`.
//
// Accuracy of ±60s is ample for a reminder, and the design survives a restart
// with nothing to rebuild — the state is a column, not a table of timers. A
// plugin may replace it by offering a tick engine (a broker), which the
// scheduler hands its sweep to at boot; the cron then stands aside so the two
// clocks cannot both fire.
@Injectable()
export class ScheduleJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduleJob.name);
  private engineTookOver = false;
  private running = false;

  constructor(
    private readonly schedule: ScheduleService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  onApplicationBootstrap(): void {
    const engine =
      this.capabilities.getCapability<ScheduleTickEngineCapability>(
        SCHEDULE_TICK_ENGINE_CAPABILITY,
      );
    this.engineTookOver = engine?.takeOver(() => this.sweep()) === true;
    if (this.engineTookOver) {
      this.logger.log('An external tick engine drives the scheduler.');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async onMinute(): Promise<void> {
    if (this.engineTookOver) return;
    await this.sweep();
  }

  // A sweep that outlasts its minute must not be joined by the next one: two
  // sweeps over the same due row would fire it twice.
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.schedule.runDue(new Date());
    } catch (err) {
      this.logger.error(`Schedule sweep failed: ${getErrorMessage(err)}`);
    } finally {
      this.running = false;
    }
  }
}
