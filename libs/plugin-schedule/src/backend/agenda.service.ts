import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  calendarSourceCapability,
  formatObjectRef,
  type CalendarItem,
  type CalendarSourceCapability,
} from '@makekeeper/plugin-contract';
import { ScheduleService } from './schedule.service';
import { occurrencesBetween } from './recurrence';

// Everything dated, in one window (#309/#310).
//
// A pull over the plugins that own the dates, never a table of its own: a
// mirrored `CalendarEntry` would be a second source of truth for `Task.dueDate`
// and would drift, and disabling a plugin would leave its rows behind. Pulling
// makes "the plugin is off" and "it has nothing this week" the same answer.
// A schedule is a referenceable object like any other, so its ref is built by
// the one formatter that owns the grammar (§5.9) — never by hand, and never
// twice in one file.
const scheduleRef = (id: string): string =>
  formatObjectRef({
    pluginId: 'schedule',
    entityType: 'schedule',
    entityId: id,
  });

@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly capabilities: CapabilityRegistryService,
    private readonly schedule: ScheduleService,
  ) {}

  async itemsInRange(from: Date, to: Date): Promise<CalendarItem[]> {
    const sources = this.capabilities.getCapabilities<CalendarSourceCapability>(
      calendarSourceCapability(''),
    );
    const collected: CalendarItem[] = [];
    // One slow or broken source must cost its own layer, not the whole day.
    const answers = await Promise.all(
      sources.map(async (source) => {
        try {
          return await source.impl.itemsInRange(
            from.toISOString(),
            to.toISOString(),
          );
        } catch (err) {
          this.logger.warn(
            `Calendar source of "${source.pluginId}" failed: ${getErrorMessage(err)}`,
          );
          return [];
        }
      }),
    );
    for (const answer of answers) collected.push(...answer);
    collected.push(...(await this.ownItems(from, to)));
    return collected.sort((a, b) => a.at.localeCompare(b.at));
  }

  // The scheduler's own layer: what each schedule will do inside the window.
  // A recurring rule contributes every firing in range, not just the next one,
  // so a week view shows a week of Mondays.
  private async ownItems(from: Date, to: Date): Promise<CalendarItem[]> {
    const schedules = await this.schedule.list();
    const items: CalendarItem[] = [];
    for (const entry of schedules) {
      if (!entry.enabled) continue;
      if (entry.trigger.kind === 'absolute') {
        for (const at of occurrencesBetween(
          entry.trigger.rrule,
          entry.trigger.timezone,
          from,
          to,
        )) {
          items.push({
            ref: scheduleRef(entry.id),
            kindKey: 'schedule.calendar.kind',
            title: entry.title,
            field: 'nextRunAt',
            at: at.toISOString(),
          });
        }
        continue;
      }
      // A relative schedule has no rule to expand — its one date is wherever
      // the object it follows currently sits.
      const next = entry.nextRunAt ? new Date(entry.nextRunAt) : null;
      if (!next || next < from || next > to) continue;
      items.push({
        ref: scheduleRef(entry.id),
        kindKey: 'schedule.calendar.kind',
        title: entry.title,
        field: 'nextRunAt',
        at: next.toISOString(),
      });
    }
    return items;
  }
}
