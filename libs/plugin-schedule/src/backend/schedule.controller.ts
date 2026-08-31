import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PluginI18nService, PluginOwner } from '@makekeeper/backend-core';
import type {
  CalendarItem,
  ScheduleTrigger,
  ScheduleView,
} from '@makekeeper/plugin-contract';
import { AgendaService } from './agenda.service';
import { ScheduleRefused, ScheduleService } from './schedule.service';
import {
  CreateScheduleDto,
  SetScheduleEnabledDto,
  SnoozeScheduleDto,
} from './schedule.dto';

// What the hook registry offers a person, resolved for the settings and
// reminder UIs: the id to schedule, its label, and whether choosing it will ask
// for confirmation.
interface HookView {
  hookId: string;
  labelKey: string;
  level: string;
}

@PluginOwner('schedule')
@Controller('schedules')
@ApiTags('schedules')
@ApiBearerAuth()
@ApiOAuth2([])
export class ScheduleController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly agenda: AgendaService,
    private readonly i18n: PluginI18nService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'i18n:schedule.api.list' })
  list(): Promise<ScheduleView[]> {
    return this.schedule.list();
  }

  // One schedule, for the dialog that shows what an entry on the calendar
  // actually is. `:id` sits AFTER the fixed segments below in the file but
  // Nest matches in declaration order, so it is declared last (see the bottom
  // of this controller) — a `:id` route declared here would swallow
  // `/calendar` and `/hooks`.

  // The calendar's one read. A window, never a page: the screen always knows
  // which days it is showing, and paging a month would be paging a thing the
  // person is looking at whole.
  @Get('calendar')
  @ApiOperation({ summary: 'i18n:schedule.api.calendar' })
  calendar(
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<CalendarItem[]> {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(this.i18n.t('schedule.errors.badRange'));
    }
    return this.agenda.itemsInRange(start, end);
  }

  @Get('hooks')
  @ApiOperation({ summary: 'i18n:schedule.api.hooks' })
  hooks(): HookView[] {
    return this.schedule.listHooks().map((hook) => ({
      hookId: hook.declaration.hookId,
      labelKey: hook.declaration.labelKey,
      level: hook.declaration.level,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'i18n:schedule.api.create' })
  async create(@Body() dto: CreateScheduleDto): Promise<ScheduleView> {
    const trigger: ScheduleTrigger =
      dto.triggerKind === 'absolute'
        ? {
            kind: 'absolute',
            rrule: dto.rrule ?? '',
            timezone: dto.timezone ?? 'UTC',
          }
        : {
            kind: 'relative',
            ref: dto.ref ?? '',
            field: dto.refField ?? '',
            offsetMinutes: dto.offsetMinutes ?? 0,
          };
    try {
      return await this.schedule.create({
        hookId: dto.hookId,
        title: dto.title,
        trigger,
        params: dto.params,
        ref: dto.ref,
        personal: dto.personal,
      });
    } catch (err) {
      // Refusals carry an i18n key, never prose: the person reads them in
      // their own language (§5.5).
      if (err instanceof ScheduleRefused) {
        throw new BadRequestException(this.i18n.t(err.reasonKey));
      }
      throw err;
    }
  }

  @Post(':id/snooze')
  @ApiOperation({ summary: 'i18n:schedule.api.snooze' })
  async snooze(
    @Param('id') id: string,
    @Body() dto: SnoozeScheduleDto,
  ): Promise<{ ok: true }> {
    if (!(await this.schedule.snooze(id, dto.minutes))) {
      throw new NotFoundException();
    }
    return { ok: true };
  }

  @Post(':id/enabled')
  @ApiOperation({ summary: 'i18n:schedule.api.setEnabled' })
  async setEnabled(
    @Param('id') id: string,
    @Body() dto: SetScheduleEnabledDto,
  ): Promise<{ ok: true }> {
    if (!(await this.schedule.setEnabled(id, dto.enabled))) {
      throw new NotFoundException();
    }
    return { ok: true };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'i18n:schedule.api.cancel' })
  async cancel(@Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.schedule.cancel(id))) throw new NotFoundException();
    return { ok: true };
  }

  // Declared last on purpose: a parameterised segment matches anything, and
  // Nest takes the first route that matches.
  @Get(':id')
  @ApiOperation({ summary: 'i18n:schedule.api.find' })
  async find(@Param('id') id: string): Promise<ScheduleView> {
    const view = await this.schedule.find(id);
    if (!view) {
      throw new NotFoundException(this.i18n.t('schedule.errors.notFound'));
    }
    return view;
  }
}
