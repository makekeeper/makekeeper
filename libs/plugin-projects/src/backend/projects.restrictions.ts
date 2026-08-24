import { PrismaService } from '@makekeeper/backend-core';
import {
  ModelConstraintMap,
  RestrictableResourceOption,
  ScopeRestrictionDescriptor,
} from '@makekeeper/plugin-contract';

// The projects plugin announces "restrict a shared scope to specific
// project(s)". Selected project ids translate into where-fragments for every
// model reachable from a project, so tasks and linked components narrow
// together with their project. Chat sessions/messages are deliberately absent:
// chats are user-private and never shared through a grant.
export function createProjectsRestriction(
  prisma: PrismaService,
): ScopeRestrictionDescriptor {
  return {
    pluginId: 'projects',
    resourceKey: 'project',
    labelKey: 'projects.restrictions.byProject',

    async listOptions(
      ownerScopeId: string,
    ): Promise<RestrictableResourceOption[]> {
      const projects = await prisma.project.findMany({
        where: { scopeId: ownerScopeId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true },
      });
      return projects.map((project) => ({
        id: project.id,
        label: project.title,
      }));
    },

    async buildModelConstraints(
      _ownerScopeId: string,
      selectedIds: string[],
    ): Promise<ModelConstraintMap> {
      const inSelection = { in: selectedIds };
      return {
        Project: { id: inSelection },
        Task: { projectId: inSelection },
        ProjectComponent: { projectId: inSelection },
        TaskComponent: { task: { projectId: inSelection } },
        TaskOrderDependency: { task: { projectId: inSelection } },
        // Files follow their project (#125): a grant narrowed to two projects
        // must not hand over the rest's photos and models. A shared attachment
        // with no project is a component photo, and a project grant does not
        // narrow the component catalogue (`Component` is absent from this map
        // for the same reason) — so it passes through. Private, parentless
        // attachments never reach a restriction at all: the scope policy
        // applies this map to the shared half only.
        Attachment: {
          OR: [{ projectId: inSelection }, { projectId: null }],
        },
      };
    },
  };
}
