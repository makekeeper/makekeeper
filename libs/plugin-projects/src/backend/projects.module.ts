import { Module, OnModuleInit } from '@nestjs/common';
import { projectsManifest } from '../manifest';
import { calendarSourceCapability } from '@makekeeper/plugin-contract';
import {
  PluginRegistryService,
  AgentRegistryService,
  PluginI18nService,
  PrismaService,
  ScopeRestrictionRegistryService,
  AttachmentStorageModule,
  AttachmentStorageService,
  StatsRegistryService,
  ExchangeRegistryService,
  CapabilityRegistryService,
} from '@makekeeper/backend-core';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectGroupsService } from './project-groups.service';
import { getProjectsTools } from './projects.tools';
import { createProjectsRestriction } from './projects.restrictions';
import { createProjectsExchangeProviders } from './projects.exchange';
import { createProjectsCalendarSource } from './projects.calendar';
import { createTableDumpProvider } from '@makekeeper/backend-core';

@Module({
  imports: [AttachmentStorageModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectGroupsService],
  exports: [ProjectsService, ProjectGroupsService],
})
export class ProjectsPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly projectsService: ProjectsService,
    private readonly groupsService: ProjectGroupsService,
    private readonly i18n: PluginI18nService,
    private readonly prisma: PrismaService,
    private readonly scopeRestrictions: ScopeRestrictionRegistryService,
    private readonly statsRegistry: StatsRegistryService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly attachments: AttachmentStorageService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(projectsManifest);
    this.i18n.registerBundle({ en, ru });
    // What this plugin puts on the calendar, and the answer a relative reminder
    // needs on every tick (#310). A capability, so the calendar never reads
    // these tables and this plugin never learns a calendar exists.
    this.capabilities.registerCapability(
      projectsManifest.id,
      calendarSourceCapability(projectsManifest.id),
      createProjectsCalendarSource(this.prisma),
    );
    // Exchange section providers (#62): project root + tasks + activity.
    for (const provider of createProjectsExchangeProviders(
      this.prisma,
      this.attachments,
      this.i18n,
    )) {
      this.exchangeRegistry.registerSectionProvider('projects', provider);
    }
    // Instance-backup dumps: whole tables verbatim, FK-safe order.
    this.exchangeRegistry.registerSectionProvider(
      'projects',
      createTableDumpProvider({
        sectionKey: 'projects.all',
        models: [
          // Groups first: a project row carries its groupId. Self-nesting, so
          // the dump is re-ordered parents-first on import.
          { name: 'projectGroup', parentKey: 'parentId' },
          'project',
          'task',
          'projectComponent',
          'taskComponent',
          'activityEvent',
        ],
        prisma: this.prisma,
      }),
    );
    this.exchangeRegistry.registerSectionProvider(
      'projects',
      createTableDumpProvider({
        sectionKey: 'projects.taskOrders',
        models: ['taskOrderDependency'],
        prisma: this.prisma,
      }),
    );
    this.agentRegistry.registerTools(
      getProjectsTools(this.projectsService, this.groupsService, this.i18n),
    );
    // Resolve project / task ORefs to their titles (a task carries its project as
    // breadcrumb) so any reference the agent holds becomes a named object (#16).
    this.agentRegistry.registerObjectRefResolver(
      'projects',
      'project',
      async (ref) => {
        const project = await this.projectsService.findOne(ref.entityId);
        return project ? { displayName: project.title } : null;
      },
    );
    this.agentRegistry.registerObjectRefResolver(
      'projects',
      'task',
      async (ref) => {
        const task = await this.projectsService.findTask(ref.entityId);
        return task
          ? { displayName: task.title, breadcrumb: task.project?.title }
          : null;
      },
    );
    // A stored file is a referenceable object too (#112): the agent receives
    // `mk://projects/file/<attachmentId>` in a turn's context line and can hand
    // it back to any tool, or link it by name in a reply. Owned by `projects`
    // because this plugin owns the Files surface an attachment belongs to — a
    // projectless one (a phone photo, a chat with no project) still resolves to
    // its name, just without a breadcrumb to lead anywhere.
    this.agentRegistry.registerObjectRefResolver(
      'projects',
      'file',
      async (ref) => {
        const file = await this.projectsService.findFile(ref.entityId);
        if (!file) return null;
        return {
          displayName: file.filename ?? file.id,
          ...(file.projectTitle ? { breadcrumb: file.projectTitle } : {}),
        };
      },
    );
    // A group is a referenceable place (#287): a chat reply links a group by
    // name, and the ancestor chain is its natural breadcrumb.
    this.agentRegistry.registerObjectRefResolver(
      'projects',
      'project-group',
      async (ref) => this.groupsService.describe(ref.entityId),
    );
    // Announce "restrict a shared scope to specific projects" (multiuser).
    this.scopeRestrictions.register(createProjectsRestriction(this.prisma));
    // Real project-activity metric (ticket #54): daily action counts per project,
    // aggregated + served by the stats plugin.
    this.statsRegistry.registerStatsProvider('projects', 'projects.activity', {
      fetchRange: (from, to) =>
        this.projectsService.getActivityCountsByDayScope(from, to),
    });
  }
}
