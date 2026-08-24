import {
  AgentTool,
  PermissionLevel,
  formatObjectRef,
  resolveEntityId,
  withPlugin,
} from '@makekeeper/plugin-contract';
import { ProjectsService } from './projects.service';
import { ProjectGroupsService } from './project-groups.service';
import { PluginI18nService } from '@makekeeper/backend-core';

// A group id, given either raw or as `mk://projects/project-group/<id>`. A ref
// naming something else is refused rather than passed through — writing into a
// folder the model did not actually name is the failure worth being loud about.
// The ownership check itself is the scoped Prisma client: the service's lookup
// only ever sees the caller's own groups.
const toGroupId = (input: unknown, i18n: PluginI18nService): string => {
  const raw = String(input ?? '');
  const resolved = resolveEntityId(raw, {
    pluginId: 'projects',
    entityType: 'project-group',
  });
  if (!resolved) {
    throw new Error(i18n.t('projects.errors.invalidGroupRef', { ref: raw }));
  }
  return resolved.id;
};

const toProjectId = (input: unknown, i18n: PluginI18nService): string => {
  const raw = String(input ?? '');
  const resolved = resolveEntityId(raw, {
    pluginId: 'projects',
    entityType: 'project',
  });
  if (!resolved) {
    throw new Error(i18n.t('projects.errors.invalidProjectRef', { ref: raw }));
  }
  return resolved.id;
};

const groupRef = (id: string): string =>
  formatObjectRef({
    pluginId: 'projects',
    entityType: 'project-group',
    entityId: id,
  }) ?? id;

export const getProjectsTools = (
  projectsService: ProjectsService,
  groupsService: ProjectGroupsService,
  i18n: PluginI18nService,
): AgentTool[] =>
  withPlugin('projects', 'plugins.projects.name', [
    // ── READ ──────────────────────────────────────────────────────────────────

    {
      name: 'list_projects',
      descriptionKey: 'projects.agentTools.list_projects.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => projectsService.findAll(),
    },

    // The folder tree projects live in (#287). Each group carries its canonical
    // ref, so a reply can link the folder by name.
    {
      name: 'list_project_groups',
      descriptionKey: 'projects.agentTools.list_project_groups.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const groups = await groupsService.list();
        return groups.map((group) => ({
          ref: groupRef(group.id),
          name: group.name,
          parentRef: group.parentId ? groupRef(group.parentId) : null,
          isDefault: group.isDefault,
          position: group.position,
        }));
      },
    },

    {
      name: 'get_project_details',
      descriptionKey: 'projects.agentTools.get_project_details.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.get_project_details.params.projectId',
          },
        },
        required: ['projectId'],
      },
      handler: async (args) => projectsService.findOne(String(args.projectId)),
    },

    // What the agent needs before it can read anything (#112): the project's
    // stored files, each already named by its canonical ORef so the reference
    // can go straight into `read_attachment` or a reply link. `projectId` is
    // required on purpose — page context rides along in the prompt, and an
    // implicit "current project" default is unpleasant to debug later.
    {
      name: 'list_project_files',
      descriptionKey: 'projects.agentTools.list_project_files.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.list_project_files.params.projectId',
          },
        },
        required: ['projectId'],
      },
      handler: async (args) => {
        const resolved = resolveEntityId(String(args.projectId ?? ''), {
          pluginId: 'projects',
          entityType: 'project',
        });
        if (!resolved) return [];
        const files = await projectsService.listFiles(resolved.id);
        return files.map((file) => ({
          ref:
            formatObjectRef({
              pluginId: 'projects',
              entityType: 'file',
              entityId: file.id,
            }) ?? file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          isImage: file.isImage,
          createdAt: file.createdAt,
        }));
      },
    },

    {
      name: 'get_task_details',
      descriptionKey: 'projects.agentTools.get_task_details.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.get_task_details.params.taskId',
          },
        },
        required: ['taskId'],
      },
      handler: async (args) =>
        projectsService.getTaskDetails(String(args.taskId)),
    },

    {
      name: 'get_shopping_list',
      descriptionKey: 'projects.agentTools.get_shopping_list.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.get_shopping_list.params.projectId',
          },
        },
        required: ['projectId'],
      },
      handler: async (args) =>
        projectsService.getShoppingList(String(args.projectId)),
    },

    // ── WRITE ─────────────────────────────────────────────────────────────────

    {
      name: 'create_project',
      descriptionKey: 'projects.agentTools.create_project.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            descriptionKey: 'projects.agentTools.create_project.params.title',
          },
          status: {
            type: 'string',
            descriptionKey: 'projects.agentTools.create_project.params.status',
          },
          description: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.create_project.params.description',
          },
          startDate: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.create_project.params.startDate',
          },
          dueDate: {
            type: 'string',
            descriptionKey: 'projects.agentTools.create_project.params.dueDate',
          },
          groupId: {
            type: 'string',
            descriptionKey: 'projects.agentTools.create_project.params.groupId',
          },
        },
        required: ['title', 'status'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.create_project',
        params: { title: String(args.title) },
      }),
      handler: async (args) =>
        projectsService.create({
          title: String(args.title),
          status: String(args.status),
          description:
            args.description === undefined
              ? undefined
              : String(args.description),
          startDate:
            args.startDate == null ? undefined : String(args.startDate),
          dueDate: args.dueDate == null ? undefined : String(args.dueDate),
          // Unnamed means the scope's General group — a project the model
          // creates without saying where must land somewhere, not fail.
          ...(args.groupId == null
            ? {}
            : { groupId: toGroupId(args.groupId, i18n) }),
        }),
    },

    {
      name: 'update_project',
      descriptionKey: 'projects.agentTools.update_project.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.update_project.params.projectId',
          },
          title: {
            type: 'string',
            descriptionKey: 'projects.agentTools.update_project.params.title',
          },
          status: {
            type: 'string',
            descriptionKey: 'projects.agentTools.update_project.params.status',
          },
          description: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.update_project.params.description',
          },
          startDate: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.update_project.params.startDate',
          },
          dueDate: {
            type: 'string',
            descriptionKey: 'projects.agentTools.update_project.params.dueDate',
          },
        },
        required: ['projectId'],
      },
      confirmSummary: async (args) => {
        const project = await projectsService.findOne(String(args.projectId));
        return {
          key: 'agentConfirm.update_project',
          params: { title: project?.title ?? String(args.projectId) },
        };
      },
      handler: async (args) =>
        projectsService.update(String(args.projectId), {
          title: args.title === undefined ? undefined : String(args.title),
          status: args.status === undefined ? undefined : String(args.status),
          description:
            args.description === undefined
              ? undefined
              : String(args.description),
          startDate:
            args.startDate == null ? undefined : String(args.startDate),
          dueDate: args.dueDate == null ? undefined : String(args.dueDate),
        }),
    },

    {
      name: 'add_task',
      descriptionKey: 'projects.agentTools.add_task.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey: 'projects.agentTools.add_task.params.projectId',
          },
          title: {
            type: 'string',
            descriptionKey: 'projects.agentTools.add_task.params.title',
          },
        },
        required: ['projectId', 'title'],
      },
      confirmSummary: async (args) => {
        const project = await projectsService.findOne(String(args.projectId));
        return {
          key: 'agentConfirm.add_task',
          params: {
            title: String(args.title),
            project: project?.title ?? String(args.projectId),
          },
        };
      },
      handler: async (args) =>
        projectsService.addTask(String(args.projectId), String(args.title)),
    },

    {
      name: 'toggle_task',
      descriptionKey: 'projects.agentTools.toggle_task.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            descriptionKey: 'projects.agentTools.toggle_task.params.taskId',
          },
          isCompleted: {
            type: 'boolean',
            descriptionKey:
              'projects.agentTools.toggle_task.params.isCompleted',
          },
        },
        required: ['taskId', 'isCompleted'],
      },
      confirmSummary: async (args) => {
        const task = await projectsService.getTaskDetails(String(args.taskId));
        const title = task?.title ?? String(args.taskId);
        return {
          // Distinct sentences for the two directions so the card states the
          // exact outcome instead of a vague "toggle".
          key: args.isCompleted
            ? 'agentConfirm.toggle_task_complete'
            : 'agentConfirm.toggle_task_reopen',
          params: { title },
        };
      },
      handler: async (args) =>
        projectsService.toggleTask(
          String(args.taskId),
          Boolean(args.isCompleted),
        ),
    },

    {
      name: 'update_task',
      descriptionKey: 'projects.agentTools.update_task.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            descriptionKey: 'projects.agentTools.update_task.params.taskId',
          },
          title: {
            type: 'string',
            descriptionKey: 'projects.agentTools.update_task.params.title',
          },
          description: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.update_task.params.description',
          },
          priority: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            descriptionKey: 'projects.agentTools.update_task.params.priority',
          },
          dueDate: {
            type: 'string',
            descriptionKey: 'projects.agentTools.update_task.params.dueDate',
          },
        },
        required: ['taskId'],
      },
      confirmSummary: async (args) => {
        const task = await projectsService.getTaskDetails(String(args.taskId));
        return {
          key: 'agentConfirm.update_task',
          params: { title: task?.title ?? String(args.taskId) },
        };
      },
      // Scope: title / description / priority / due date. Completion is owned by
      // toggle_task; component/order links have their own dedicated flows.
      handler: async (args) =>
        projectsService.updateTask(String(args.taskId), {
          title: args.title === undefined ? undefined : String(args.title),
          description:
            args.description === undefined
              ? undefined
              : String(args.description),
          priority:
            args.priority === undefined ? undefined : String(args.priority),
          dueDate: args.dueDate == null ? undefined : String(args.dueDate),
        }),
    },

    {
      name: 'link_component_to_project',
      descriptionKey:
        'projects.agentTools.link_component_to_project.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.link_component_to_project.params.projectId',
          },
          componentId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.link_component_to_project.params.componentId',
          },
          neededQty: {
            type: 'number',
            descriptionKey:
              'projects.agentTools.link_component_to_project.params.neededQty',
          },
        },
        required: ['projectId', 'componentId', 'neededQty'],
      },
      confirmSummary: async (args) => {
        const [project, component] = await Promise.all([
          projectsService.findOne(String(args.projectId)),
          projectsService.findComponent(String(args.componentId)),
        ]);
        return {
          key: 'agentConfirm.link_component_to_project',
          params: {
            component: component?.name ?? String(args.componentId),
            project: project?.title ?? String(args.projectId),
            qty: String(Number(args.neededQty)),
          },
        };
      },
      handler: async (args) =>
        projectsService.linkComponent(
          String(args.projectId),
          String(args.componentId),
          Number(args.neededQty),
        ),
    },

    {
      name: 'create_project_group',
      descriptionKey: 'projects.agentTools.create_project_group.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.create_project_group.params.name',
          },
          parentId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.create_project_group.params.parentId',
          },
        },
        required: ['name'],
      },
      confirmSummary: (args) => ({
        key: 'agentConfirm.create_project_group',
        params: { name: String(args.name) },
      }),
      handler: async (args) => {
        const group = await groupsService.create({
          name: String(args.name),
          parentId:
            args.parentId == null ? null : toGroupId(args.parentId, i18n),
        });
        return { ...group, ref: groupRef(group.id) };
      },
    },

    {
      name: 'move_project_to_group',
      descriptionKey: 'projects.agentTools.move_project_to_group.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.move_project_to_group.params.projectId',
          },
          groupId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.move_project_to_group.params.groupId',
          },
        },
        required: ['projectId', 'groupId'],
      },
      confirmSummary: async (args) => {
        const [project, group] = await Promise.all([
          projectsService.findOne(toProjectId(args.projectId, i18n)),
          groupsService.describe(toGroupId(args.groupId, i18n)),
        ]);
        return {
          key: 'agentConfirm.move_project_to_group',
          params: {
            project: project?.title ?? String(args.projectId),
            group: group?.displayName ?? String(args.groupId),
          },
        };
      },
      handler: async (args) => {
        const groupId = toGroupId(args.groupId, i18n);
        const result = await groupsService.moveProjects(
          [toProjectId(args.projectId, i18n)],
          groupId,
        );
        return { ...result, ref: groupRef(groupId) };
      },
    },

    // ── DESTRUCTIVE ───────────────────────────────────────────────────────────

    {
      name: 'delete_project',
      descriptionKey: 'projects.agentTools.delete_project.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.delete_project.params.projectId',
          },
        },
        required: ['projectId'],
      },
      confirmSummary: async (args) => {
        const project = await projectsService.findOne(String(args.projectId));
        return {
          key: 'agentConfirm.delete_project',
          params: { title: project?.title ?? String(args.projectId) },
        };
      },
      handler: async (args) => projectsService.delete(String(args.projectId)),
    },

    // Deleting a folder never deletes what is in it: the projects and subgroups
    // are lifted to the parent (General for a root group). The confirmation
    // states those counts, so the gate is a decision and not a leap.
    {
      name: 'delete_project_group',
      descriptionKey: 'projects.agentTools.delete_project_group.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          groupId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.delete_project_group.params.groupId',
          },
        },
        required: ['groupId'],
      },
      confirmSummary: async (args) => {
        const id = toGroupId(args.groupId, i18n);
        const [group, preview] = await Promise.all([
          groupsService.describe(id),
          groupsService.deletePreview(id),
        ]);
        const target = await groupsService.describe(preview.destinationId);
        return {
          key: 'agentConfirm.delete_project_group',
          params: {
            name: group?.displayName ?? String(args.groupId),
            projects: String(preview.projects),
            subgroups: String(preview.subgroups),
            destination: target?.displayName ?? '',
          },
        };
      },
      handler: async (args) =>
        groupsService.delete(toGroupId(args.groupId, i18n)),
    },

    {
      name: 'delete_task',
      descriptionKey: 'projects.agentTools.delete_task.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            descriptionKey: 'projects.agentTools.delete_task.params.taskId',
          },
        },
        required: ['taskId'],
      },
      confirmSummary: async (args) => {
        const task = await projectsService.getTaskDetails(String(args.taskId));
        return {
          key: 'agentConfirm.delete_task',
          params: { title: task?.title ?? String(args.taskId) },
        };
      },
      handler: async (args) => projectsService.deleteTask(String(args.taskId)),
    },

    {
      name: 'unlink_component_from_project',
      descriptionKey:
        'projects.agentTools.unlink_component_from_project.description',
      permission: PermissionLevel.DESTRUCTIVE,
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.unlink_component_from_project.params.projectId',
          },
          componentId: {
            type: 'string',
            descriptionKey:
              'projects.agentTools.unlink_component_from_project.params.componentId',
          },
        },
        required: ['projectId', 'componentId'],
      },
      confirmSummary: async (args) => {
        const [project, component] = await Promise.all([
          projectsService.findOne(String(args.projectId)),
          projectsService.findComponent(String(args.componentId)),
        ]);
        return {
          key: 'agentConfirm.unlink_component_from_project',
          params: {
            component: component?.name ?? String(args.componentId),
            project: project?.title ?? String(args.projectId),
          },
        };
      },
      handler: async (args) =>
        projectsService.unlinkComponent(
          String(args.projectId),
          String(args.componentId),
        ),
    },
  ]);
