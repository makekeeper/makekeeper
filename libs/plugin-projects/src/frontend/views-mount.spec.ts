import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import ProjectsView from './ProjectsView.vue';
import ProjectGroupsSettings from './ProjectGroupsSettings.vue';
import ProjectFormView from './ProjectFormView.vue';
import ProjectDetailView from './ProjectDetailView.vue';
import ProjectsGantt from './ProjectsGantt.vue';
import type { ProjectSummary } from './shared';
import en from '../i18n/en.json';

// A smoke mount per screen. Nothing in this repo type-checks or renders a Vue
// SFC before it reaches a browser, and this suite exists because that hole let
// through two setup-time ReferenceErrors on this very branch: a `watch` whose
// source computed read refs declared further down the file, and a template
// bound to state nobody declared. Both are invisible to lint, to `nx build`
// and to every other spec here — and both stop the screen mounting at all.
//
// So: mount each screen, fail on any error the component throws during setup or
// render. Assertions beyond "it rendered" belong in focused specs.

const blank = { template: '<div />' };

// A real-shaped row for the LIST endpoint, so every card-rendering branch runs.
const listProject = {
  id: 'p1',
  title: 'Robot arm',
  description: '',
  status: 'IN_PROGRESS',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  startDate: null,
  dueDate: null,
  completedAt: null,
  position: 0,
  groupId: 'g1',
  coverUrl: null,
  tasksCount: 2,
  completedTasksCount: 1,
  componentsCount: 0,
  actualBudget: 0,
};

const routes: RouteRecordRaw[] = [
  { path: '/', component: blank },
  { path: '/projects', name: 'projects', component: blank },
  { path: '/projects/new', name: 'project-new', component: blank },
  { path: '/settings', name: 'settings', component: blank },
  { path: '/projects/:id', name: 'project-detail', component: blank },
];

function makeRouter() {
  return createRouter({ history: createWebHistory(), routes });
}

// This suite asserts that a screen mounts, never what it says, so it carries
// only the plugin's own bundle — reaching into the app shell's locales would
// cross the plugin boundary for nothing. Unresolved core keys render as their
// key, which is a rendered screen all the same.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

beforeEach(() => {
  setActivePinia(createPinia());
  // Advanced mode, because the SIMPLE card badge routes through the bucket
  // labels and never touches the per-status maps — which is precisely how a
  // missing import in those maps stayed invisible to this suite (#294).
  localStorage.setItem('uxMode', 'advanced');
  // Every screen fetches on mount; an unanswered request must not be what
  // decides whether this test passes. The detail screen gets a real-shaped
  // project back — it renders its hero from that row, so an empty answer would
  // be testing the null branch instead of the screen.
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      // The LIST answers with a project, not an empty array. An empty list
      // renders no cards, and the card is what evaluates the status maps — the
      // empty-list stub let a missing import through as a lazily-thrown
      // ReferenceError nothing on this branch ever reached (#294).
      if (/\/api\/projects(\?|$)/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify([listProject]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      const body = /\/api\/projects\/p1(\?|$)/.test(url)
        ? {
            id: 'p1',
            title: 'Robot arm',
            description: '',
            status: 'IN_PROGRESS',
            groupId: 'g1',
            createdAt: '2026-01-01T00:00:00.000Z',
            startDate: null,
            dueDate: null,
            tasksCount: 0,
            completedTasksCount: 0,
            componentsCount: 0,
            tasks: [],
            components: [],
            relatedOrders: [],
            actualBudget: 0,
          }
        : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
});

async function mountView(component: unknown, path: string): Promise<string> {
  const router = makeRouter();
  await router.push(path);
  await router.isReady();
  const errors: unknown[] = [];
  const wrapper = mount(component as never, {
    global: {
      plugins: [i18n, router],
      config: { errorHandler: (err: unknown) => errors.push(err) },
    },
  });
  // Let onMounted and the fetches it starts settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (errors.length) throw errors[0];
  return wrapper.html();
}

// The timeline (#294) is mounted directly rather than through the list: the
// third view sits behind the advanced UX lens, so a `?view=gantt` mount would
// quietly render the grid and assert nothing about the timeline's own template.
function ganttProject(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p1',
    title: 'Robot arm',
    description: '',
    status: 'IN_PROGRESS',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    startDate: '2026-04-10T00:00:00.000Z',
    dueDate: '2026-08-30T00:00:00.000Z',
    completedAt: null,
    position: 0,
    groupId: 'g1',
    coverUrl: null,
    tasksCount: 4,
    completedTasksCount: 2,
    componentsCount: 0,
    actualBudget: 0,
    ...over,
  };
}

describe('projects screens mount', () => {
  // One project per edge state the layout can produce, so the template is
  // rendered through every branch it has — not just the happy one.
  it('renders the timeline across every edge state', async () => {
    const router = makeRouter();
    await router.push('/projects?view=gantt');
    await router.isReady();
    const errors: unknown[] = [];
    const wrapper = mount(ProjectsGantt, {
      props: {
        projects: [
          ganttProject(),
          ganttProject({ id: 'p2', startDate: null, dueDate: null }),
          ganttProject({
            id: 'p3',
            status: 'COMPLETED',
            completedAt: '2026-06-14T00:00:00.000Z',
          }),
          ganttProject({
            id: 'p4',
            status: 'COMPLETED',
            startDate: null,
            dueDate: null,
            completedAt: null,
          }),
          ganttProject({
            id: 'p5',
            groupId: 'g2',
            tasksCount: 0,
            completedTasksCount: 0,
          }),
        ],
      },
      global: {
        plugins: [i18n, router],
        config: { errorHandler: (err: unknown) => errors.push(err) },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (errors.length) throw errors[0];
    expect(wrapper.html()).toContain('Robot arm');
  });

  it('renders the timeline with nothing to show', async () => {
    const router = makeRouter();
    // `isReady` only settles once the router has actually navigated somewhere.
    await router.push('/projects');
    await router.isReady();
    const wrapper = mount(ProjectsGantt, {
      props: { projects: [] },
      global: { plugins: [i18n, router] },
    });
    expect(wrapper.html()).toContain('div');
  });

  it('renders the projects list', async () => {
    expect(await mountView(ProjectsView, '/projects')).toContain('div');
  });

  it('renders the projects list filtered to a group', async () => {
    expect(
      await mountView(ProjectsView, '/projects?group=g1&view=board'),
    ).toContain('div');
  });

  it('renders the projects list asked for the timeline', async () => {
    expect(await mountView(ProjectsView, '/projects?view=gantt')).toContain(
      'div',
    );
  });

  it('renders the groups settings panel', async () => {
    expect(await mountView(ProjectGroupsSettings, '/settings')).toContain(
      'div',
    );
  });

  it('renders the project form in create mode', async () => {
    expect(await mountView(ProjectFormView, '/projects/new')).toContain('div');
  });

  it('renders the project detail', async () => {
    expect(await mountView(ProjectDetailView, '/projects/p1')).toContain('div');
  });
});
