<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import {
  getPluginSettingsPanels,
  resolvePluginIcon as resolveIcon,
  usePluginsStore,
  useSessionStore,
  useRouteQuery,
  useUxMode,
  PageHeader,
  EmptyState,
  SectionNav,
  Badge,
  type RegisteredSettingsPanel,
  type SectionNavItem,
} from '@makekeeper/frontend-core';
import { Settings, Terminal } from '@lucide/vue';
import SectionShell from './SectionShell.vue';
import ApiSection from './ApiSection.vue';

// Generic settings host: one section per plugin that declares its own settings
// panel, the picker on the left and that plugin's component filling the pane
// (#266). It used to stack every panel in one scroll — roughly 2,300 lines of
// them — with collapsible groups, a persisted memory of which were folded, and
// a hand-rolled `#settings-<id>` deep link that expanded a group and scrolled
// to it. All three existed to make a scroll survivable that should not have
// been a scroll (#262).
//
// Panels of disabled plugins are hidden; panels whose manifest declares
// `settingsAdminOnly` are hidden from regular users while multi-user mode is
// on (the plugin itself may still be usable — only its administration is).
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const pluginsStore = usePluginsStore();
const session = useSessionStore();

const panels = computed<RegisteredSettingsPanel[]>(() =>
  getPluginSettingsPanels().filter(
    (p) =>
      pluginsStore.isEnabled(p.pluginId) &&
      (!session.multiuserEnabled ||
        session.isAdmin ||
        pluginsStore.byId[p.pluginId]?.settingsAdminOnly !== true),
  ),
);

// The host's own section (#282): how to script against this instance. It is
// not a plugin panel — the settings plugin owns this page — so it is a second
// KIND of section rather than a fake entry in the registry. Pro-tier under the
// UX lens (#269): scripting is depth, so simple mode hides it and the toggle
// under `settings.api` brings it back.
const API_SECTION = 'api';

const { isFeatureVisible } = useUxMode();
const showsApi = computed<boolean>(() => isFeatureVisible('settings.api'));

// Section keys in picker order: every visible plugin panel, then the host's.
const sectionKeys = computed<string[]>(() => [
  ...panels.value.map((p) => p.pluginId),
  ...(showsApi.value ? [API_SECTION] : []),
]);

const defaultSection = computed<string>(() => sectionKeys.value[0] ?? '');

// The open section is route state (§5.3). The sections are registry data, so
// there is no literal union to guard the key: a `?section=` naming a panel
// this user cannot see falls back to the default rather than leaving a blank
// pane — or admitting the panel exists.
const sectionQuery = useRouteQuery('section');

const section = computed<string>(() => {
  const requested = sectionQuery.value;
  return sectionKeys.value.includes(requested)
    ? requested
    : defaultSection.value;
});

const activePanel = computed<RegisteredSettingsPanel | undefined>(() =>
  panels.value.find((p) => p.pluginId === section.value),
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

const items = computed<SectionNavItem[]>(() => [
  ...panels.value.map((panel) => ({
    key: panel.pluginId,
    label: t(panel.nameKey),
    description: t(panel.descriptionKey),
    to: sectionRoute(panel.pluginId),
    icon: resolveIcon(panel.icon),
  })),
  ...(showsApi.value
    ? [
        {
          key: API_SECTION,
          label: t('settings.api.title'),
          description: t('settings.api.subtitle'),
          to: sectionRoute(API_SECTION),
          icon: Terminal,
        },
      ]
    : []),
]);

// The old deep link — `#settings-<pluginId>`, which expanded a group and
// scrolled to it — is dead as an anchor, but it is out there in bookmarks and
// in anything already shared. Rewrite it to the query form once, rather than
// letting it land on the default section and silently do nothing.
//
// Not a second write mechanism for the section: it translates a legacy URL and
// then never runs again, which is why it drops the hash as it goes.
const LEGACY_HASH_PREFIX = '#settings-';

const redirectLegacyHash = (): void => {
  const hash = route.hash;
  if (!hash.startsWith(LEGACY_HASH_PREFIX)) return;
  const pluginId = hash.slice(LEGACY_HASH_PREFIX.length);
  const known = panels.value.some((p) => p.pluginId === pluginId);
  void router
    .replace({
      query: known ? { ...route.query, section: pluginId } : { ...route.query },
      hash: '',
    })
    .catch(() => undefined);
};

onMounted(redirectLegacyHash);
watch(() => route.hash, redirectLegacyHash);
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('settings.pluginSettings.title')"
      :subtitle="$t('settings.pluginSettings.subtitle')"
      :icon="Settings"
    />

    <EmptyState
      v-if="sectionKeys.length === 0"
      class="py-8"
      :icon="Settings"
      :title="$t('settings.pluginSettings.empty')"
    />

    <div v-else class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SectionNav
        :items="items"
        :active-key="section"
        :aria-label="$t('settings.pluginSettings.sections.ariaLabel')"
        class="lg:sticky lg:top-6 lg:self-start"
      />

      <div class="min-w-0">
        <!-- Keyed per plugin and kept alive: a half-filled provider form must
             survive a look at another plugin's settings, and coming back must
             not refetch everything. -->
        <KeepAlive>
          <SectionShell
            v-if="section === API_SECTION"
            :title="$t('settings.api.title')"
            :description="$t('settings.api.subtitle')"
          >
            <div class="glass-card rounded-2xl p-6">
              <ApiSection />
            </div>
          </SectionShell>
          <SectionShell
            v-else-if="activePanel"
            :key="activePanel.pluginId"
            :title="$t(activePanel.nameKey)"
            :description="$t(activePanel.descriptionKey)"
          >
            <template #actions>
              <Badge tone="neutral">
                {{
                  $t('settings.pluginSettings.version', {
                    version: activePanel.version,
                  })
                }}
              </Badge>
            </template>
            <div class="glass-card rounded-2xl p-6">
              <component :is="activePanel.component" />
            </div>
          </SectionShell>
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
