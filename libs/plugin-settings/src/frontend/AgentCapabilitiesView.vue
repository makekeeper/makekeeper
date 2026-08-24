<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import {
  PageHeader,
  SectionNav,
  Spinner,
  EmptyState,
  resolvePluginIcon as resolveIcon,
  usePluginsStore,
  useRouteQuery,
  useToastStore,
  apiFetch,
  type SectionNavItem,
} from '@makekeeper/frontend-core';
import { ShieldAlert } from '@lucide/vue';
import SectionShell from './SectionShell.vue';
import AgentToolsSection from './AgentToolsSection.vue';
import {
  autoRunCount,
  type AgentToolConfig,
  type AgentToolGroup,
} from './agent-tools';

// The instance-wide agent tool policy, one section per plugin that declares
// tools (#265). It used to be one page-long scroll of collapsible groups, with
// which groups were folded persisted to localStorage — the page storing the
// user's workaround for its own layout. A fold is a workaround for a layout,
// not a structure (#262).
//
// Unlike the external-plugins page the section list is DATA: the groups the
// backend serves, filtered by the plugins this user can see. So there is no
// literal union to guard the key, and a `?section=` naming a plugin that is
// gone has to fall back rather than leave a blank pane.
const { t } = useI18n();
const route = useRoute();
const toast = useToastStore();

const groups = ref<AgentToolGroup[]>([]);
const loading = ref(true);

// Hide capability groups of disabled plugins (the backend still lists them).
const pluginsStore = usePluginsStore();
const visibleGroups = computed<AgentToolGroup[]>(() =>
  groups.value.filter((g) => pluginsStore.isEnabled(g.pluginId)),
);

// The default is the first group that exists — which is nothing at all until
// the fetch resolves, and that is the correct answer for an empty page.
const defaultSection = computed<string>(
  () => visibleGroups.value[0]?.pluginId ?? '',
);

// The open section is route state: reload, back/forward and a pasted link all
// land on the same section (§5.3 — no hand-rolled `currentTab`).
const sectionQuery = useRouteQuery('section');

const section = computed<string>(() => {
  const requested = sectionQuery.value;
  const exists = visibleGroups.value.some((g) => g.pluginId === requested);
  return exists ? requested : defaultSection.value;
});

const activeGroup = computed<AgentToolGroup | undefined>(() =>
  visibleGroups.value.find((g) => g.pluginId === section.value),
);

// The picker navigates with links, so a section is openable in a new tab —
// which `useRouteQuery`'s writable side (a `replace`) cannot express. The
// default section drops the key, exactly as an assignment would.
const sectionRoute = (value: string): RouteLocationRaw => {
  const query = { ...route.query };
  if (value === defaultSection.value) delete query['section'];
  else query['section'] = value;
  return { query };
};

const items = computed<SectionNavItem[]>(() =>
  visibleGroups.value.map((group) => {
    const auto = autoRunCount(group);
    return {
      key: group.pluginId,
      label: t(group.pluginLabelKey),
      description: t('settings.agentCapabilities.toolsCount', {
        count: group.tools.length,
      }),
      to: sectionRoute(group.pluginId),
      icon: resolveIcon(group.icon),
      badge: auto,
      // A count on its own is announced as "Inventory 3"; what it counts is
      // the whole reason an admin opens this page.
      badgeLabel:
        auto > 0
          ? t('settings.agentCapabilities.sections.autoRun', { count: auto })
          : undefined,
    };
  }),
);

// A load that failed and an instance with no agent tools are not the same
// answer, and the empty state says the second one out loud. Kept apart so a
// broken fetch never renders as "this instance has no agent capabilities".
const failed = ref(false);

const fetchAgentTools = async (): Promise<void> => {
  try {
    loading.value = true;
    failed.value = false;
    const response = await apiFetch('/api/settings/agent-tools');
    if (!response.ok) throw new Error(response.statusText);
    groups.value = await response.json();
  } catch {
    failed.value = true;
    toast.error(t('settings.agentCapabilities.loadError'));
  } finally {
    loading.value = false;
  }
};

const updateToolConfig = async (
  tool: AgentToolConfig,
  patch: Partial<Pick<AgentToolConfig, 'isEnabled' | 'confirmationPolicy'>>,
): Promise<void> => {
  // Applied here, not in the row: the section renders the groups this view
  // owns, so the badge counting auto-run tools updates with the switch.
  const previous = {
    isEnabled: tool.isEnabled,
    confirmationPolicy: tool.confirmationPolicy,
  };
  Object.assign(tool, patch);
  // A refused PATCH must not leave a switch describing a permission the
  // backend does not have — this page IS the record of what the agent may do,
  // and the picker's badge is counted from these very values.
  try {
    const response = await apiFetch(`/api/settings/agent-tools/${tool.name}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isEnabled: tool.isEnabled,
        confirmationPolicy: tool.confirmationPolicy,
      }),
    });
    if (!response.ok) throw new Error(response.statusText);
  } catch {
    Object.assign(tool, previous);
    toast.error(t('settings.agentCapabilities.saveFailed'));
  }
};

onMounted(() => {
  fetchAgentTools();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('settings.agentCapabilities.title')"
      :subtitle="$t('settings.agentCapabilities.subtitle')"
      :icon="ShieldAlert"
    />

    <div v-if="loading" class="flex justify-center py-12">
      <Spinner />
    </div>

    <p
      v-else-if="failed"
      class="glass-card rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('settings.agentCapabilities.loadError') }}
    </p>

    <EmptyState
      v-else-if="visibleGroups.length === 0"
      class="py-8"
      :icon="ShieldAlert"
      :title="$t('settings.agentCapabilities.empty')"
    />

    <div v-else class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SectionNav
        :items="items"
        :active-key="section"
        :aria-label="$t('settings.agentCapabilities.sections.ariaLabel')"
        class="lg:sticky lg:top-6 lg:self-start"
      />

      <div class="min-w-0">
        <!-- Keyed per plugin and kept alive: switching sections must not throw
             away a table the admin is halfway through reviewing. -->
        <KeepAlive>
          <SectionShell
            v-if="activeGroup"
            :key="activeGroup.pluginId"
            :title="$t(activeGroup.pluginLabelKey)"
            :description="
              $t('settings.agentCapabilities.toolsCount', {
                count: activeGroup.tools.length,
              })
            "
          >
            <AgentToolsSection
              :group="activeGroup"
              @change="updateToolConfig"
            />
          </SectionShell>
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
