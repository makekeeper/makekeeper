import { Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import {
  AgentRegistryModule,
  AgentRegistryService,
  CapabilityRegistryService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  NOTIFY_BUS_CAPABILITY,
  SCHEDULE_CAPABILITY,
  type NotifyBusCapability,
  type ScheduleCapability,
} from '@makekeeper/plugin-contract';
import { scheduleManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ScheduleJob } from './schedule.job';
import { AgendaService } from './agenda.service';
import { getScheduleTools } from './schedule.tools';

@Module({
  imports: [PrismaModule, AgentRegistryModule],
  controllers: [ScheduleController],
  providers: [ScheduleService, ScheduleJob, AgendaService],
  exports: [ScheduleService, AgendaService],
})
export class SchedulePluginModule
  implements OnModuleInit, OnApplicationBootstrap
{
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly schedule: ScheduleService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly agenda: AgendaService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly context: RequestContextService,
  ) {}

  onModuleInit(): void {
    this.registry.register(scheduleManifest);
    this.i18n.registerBundle({ en, ru });
    this.agentRegistry.registerTools(
      getScheduleTools(this.schedule, this.agenda, this.context),
    );
    // A schedule is itself referenceable, so a reminder in a chat reply renders
    // as a link rather than a bare mk:// string (§5.9).
    this.agentRegistry.registerObjectRefResolver(
      'schedule',
      'schedule',
      async (ref) => {
        const found = (await this.schedule.list()).find(
          (entry) => entry.id === ref.entityId,
        );
        return found ? { displayName: found.title } : null;
      },
    );
    // Offered as a capability so a plugin can declare what it does at a moment
    // without importing the scheduler; `null` means the app cannot schedule and
    // the caller degrades (§5.10).
    this.capabilities.registerCapability<ScheduleCapability>(
      scheduleManifest.id,
      SCHEDULE_CAPABILITY,
      {
        registerHook: (pluginId, declaration, handler) =>
          this.schedule.registerHook(pluginId, declaration, handler),
        create: (input) => this.schedule.create(input),
        cancel: (id) => this.schedule.cancel(id),
        snooze: (id, minutes) => this.schedule.snooze(id, minutes),
      },
    );
  }

  // A reminder is a notification, so its TYPE belongs to the settings matrix
  // like every other: declared once, seeded with its default, and configurable
  // afterwards. Declared on bootstrap so the bus is certainly registered (#309).
  onApplicationBootstrap(): void {
    const bus = this.capabilities.getCapability<NotifyBusCapability>(
      NOTIFY_BUS_CAPABILITY,
    );
    bus?.declareTypes(scheduleManifest.id, [
      {
        type: 'schedule.reminder',
        labelKey: 'schedule.reminder.typeLabel',
        defaultImportance: 'normal',
      },
    ]);
  }
}
