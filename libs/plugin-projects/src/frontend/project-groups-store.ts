import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import {
  apiJson,
  buildTreeOptions,
  useAgentDataChanged,
  useSessionStore,
  useUxMode,
  type TreeOption,
} from '@makekeeper/frontend-core';
import type { PluginNavChild } from '@makekeeper/plugin-contract';
import type { ProjectGroupDto } from '../project-groups';

// The project group tree, held once for the whole app (§5.3): the sidebar's
// sub-items, the groups page and the project form all read the same list, so a
// rename shows up everywhere at once instead of three screens disagreeing.
export const useProjectGroupsStore = defineStore('project-groups', () => {
  const groups = ref<ProjectGroupDto[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  // Whether the last load failed, and whether one was ever attempted. The
  // sidebar's provider asks for the tree on EVERY render, so "not loaded yet"
  // must not double as "try again": a single failing fetch would otherwise
  // become one request per frame, forever.
  const failed = ref(false);
  const attempted = ref(false);

  const byId = computed(
    () => new Map(groups.value.map((group) => [group.id, group])),
  );

  const roots = computed(() =>
    groups.value.filter((group) => group.parentId === null),
  );

  const defaultGroup = computed(
    () => groups.value.find((group) => group.isDefault) ?? null,
  );

  // The tree as the shared `Select` wants it: `depth`/`parentValue` give the
  // primitive its indentation and its ancestor-aware filter. Derived once here
  // because three screens pick a group (form, groups page, bulk move) and three
  // copies of the same walk is how they end up ordering it differently.
  const options = computed<TreeOption<string>[]>(() =>
    buildTreeOptions(
      groups.value.map((group) => ({
        value: group.id,
        label: group.name,
        parentValue: group.parentId,
        order: group.position,
      })),
    ),
  );

  async function refresh(): Promise<void> {
    // The shell asks for the tree as soon as it renders the sidebar; a fetch
    // fired before login would 401 (shell-level fetches must not run
    // pre-login, §5.8).
    const session = useSessionStore();
    if (session.multiuserEnabled && !session.isAuthenticated) return;
    loading.value = true;
    attempted.value = true;
    try {
      groups.value = await apiJson<ProjectGroupDto[]>('/api/projects/groups');
      loaded.value = true;
      failed.value = false;
    } catch (err) {
      failed.value = true;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  // Fetch once per session unless a caller asks for fresh data. A previous
  // failure is remembered, not retried on sight — an explicit `refresh()` (a
  // revisit, a write) is what tries again.
  async function ensureLoaded(): Promise<void> {
    if (loaded.value || loading.value || attempted.value) return;
    await refresh();
  }

  async function create(input: {
    name: string;
    parentId: string | null;
  }): Promise<ProjectGroupDto> {
    const created = await apiJson<ProjectGroupDto>('/api/projects/groups', {
      method: 'POST',
      body: input,
    });
    await refresh();
    return created;
  }

  async function update(
    id: string,
    input: { name?: string; parentId?: string | null; position?: number },
  ): Promise<ProjectGroupDto> {
    const updated = await apiJson<ProjectGroupDto>(
      `/api/projects/groups/${id}`,
      { method: 'PATCH', body: input },
    );
    await refresh();
    return updated;
  }

  async function deletePreview(
    id: string,
  ): Promise<{ projects: number; subgroups: number; destinationId: string }> {
    return apiJson(`/api/projects/groups/${id}/delete-preview`);
  }

  async function remove(id: string): Promise<void> {
    await apiJson(`/api/projects/groups/${id}`, { method: 'DELETE' });
    await refresh();
  }

  async function reorder(input: {
    parentId: string | null;
    orderedIds: string[];
    movedId: string;
  }): Promise<void> {
    // The endpoint answers with the reordered tree, so the new state lands here
    // without a second round trip.
    groups.value = await apiJson<ProjectGroupDto[]>(
      '/api/projects/groups/reorder',
      { method: 'PATCH', body: input },
    );
  }

  // The agent creates, renames and deletes groups too (#287) — and every
  // surface this store feeds (the sidebar sub-items, the settings tree, the
  // list filter, the card names) went stale until a reload. Refetch quietly on
  // each turn; the current tree stays on screen until the answer replaces it.
  // Failures stay silent here — a background refresh has no user action to
  // blame, and the next explicit load will surface what is wrong.
  watch(useAgentDataChanged(), () => {
    if (!attempted.value) return;
    void refresh().catch(() => undefined);
  });

  return {
    groups,
    loaded,
    loading,
    failed,
    byId,
    roots,
    defaultGroup,
    options,
    refresh,
    ensureLoaded,
    create,
    update,
    deletePreview,
    remove,
    reorder,
  };
});

// The sidebar's sub-items for the Projects entry (#288). Top level only — a
// folder tree in the rail stops being navigation past one indent — and the
// label is the group's own name, i.e. TEXT rather than an i18n key, which is
// what `PluginNavChild.label` documents.
export function projectGroupNavChildren(): PluginNavChild[] {
  // Simple mode has no groups surface at all (#289) — no expansion in the rail,
  // and no fetch behind it either.
  if (!useUxMode().isFeatureVisible('projects.groups')) return [];
  const store = useProjectGroupsStore();
  // Called from the sidebar's computed on every render: the first call starts
  // the fetch and the next one — after the store resolves — renders it. A
  // failure costs the sub-items, never the sidebar.
  void store.ensureLoaded().catch(() => undefined);
  return store.roots.map((group) => ({
    id: group.id,
    path: `/projects?group=${encodeURIComponent(group.id)}`,
    label: group.name,
  }));
}
