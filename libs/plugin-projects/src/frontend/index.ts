import {
  bindDashboardWidgets,
  registerPlugin,
} from '@makekeeper/frontend-core';
import { projectsManifest } from '../manifest';
import BenchWidget from './dashboard/BenchWidget.vue';
import ActiveProjectsStatWidget from './dashboard/ActiveProjectsStatWidget.vue';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import ProjectsView from './ProjectsView.vue';
import ProjectDetailView from './ProjectDetailView.vue';
import ProjectFormView from './ProjectFormView.vue';
import TaskFormView from './TaskFormView.vue';
import LinkComponentView from './LinkComponentView.vue';
import ProjectFileRedirectView from './ProjectFileRedirectView.vue';
import ProjectGroupsSettings from './ProjectGroupsSettings.vue';
import { projectGroupNavChildren } from './project-groups-store';

registerPlugin({
  id: projectsManifest.id,
  nameKey: projectsManifest.nameKey,
  navigation: projectsManifest.navigation,
  messages: { en, ru },
  uxFeatures: projectsManifest.uxFeatures,
  dashboardWidgets: bindDashboardWidgets(projectsManifest.dashboardWidgets, {
    'projects.bench': BenchWidget,
    'projects.activeCount': ActiveProjectsStatWidget,
  }),
  statsCharts: projectsManifest.statsCharts,
  // Project groups are managed in Settings → General, as this plugin's own
  // section — the projects list links there instead of owning a second screen.
  settings: {
    descriptionKey: 'projects.groups.settingsDescription',
    version: projectsManifest.version,
    icon: 'FolderTree',
    component: ProjectGroupsSettings,
  },
  // The Projects entry's runtime sub-items (#288): the scope's top-level groups.
  navChildrenProviders: { 'projects.groups': projectGroupNavChildren },
  routes: [
    { path: '/projects', name: 'projects', component: ProjectsView },
    { path: '/projects/new', name: 'project-new', component: ProjectFormView },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: ProjectDetailView,
    },
    {
      path: '/projects/:id/edit',
      name: 'project-edit',
      component: ProjectFormView,
    },
    // The `new` route must precede the `:taskId` route so it isn't swallowed as
    // an id. TaskFormView already branches on taskId === 'new' for the create flow.
    {
      path: '/projects/:projectId/tasks/new',
      name: 'task-new',
      component: TaskFormView,
    },
    {
      path: '/projects/:projectId/tasks/:taskId',
      name: 'task-form',
      component: TaskFormView,
    },
    {
      path: '/projects/:id/components/link',
      name: 'project-link-component',
      component: LinkComponentView,
    },
    // Landing for a file ORef: resolves the attachment to its project, then
    // replaces itself with that project's Files tab. Literal segment, so it
    // never competes with `/projects/:id`.
    {
      path: '/projects/files/:attachmentId',
      name: 'project-file-link',
      component: ProjectFileRedirectView,
    },
  ],
  // A project ORef navigates to its detail screen. A file ORef carries only the
  // attachment id, so it lands on the redirect route above, which looks the
  // project up and forwards. A task ORef has the same gap but no such landing
  // yet, so it stays a non-link (null) rather than resolving to a broken route.
  refToRoute: (ref) => {
    if (ref.entityType === 'project')
      return { path: `/projects/${ref.entityId}` };
    if (ref.entityType === 'file') {
      return { path: `/projects/files/${ref.entityId}` };
    }
    // A group is a place in the projects list, so its link is that list
    // filtered to it — the same route the sidebar's sub-items use.
    if (ref.entityType === 'project-group') {
      return { path: '/projects', query: { group: ref.entityId } };
    }
    return null;
  },
});
