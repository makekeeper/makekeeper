<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import {
  PageHeader,
  SectionNav,
  useRouteQuery,
  type SectionNavItem,
} from '@makekeeper/frontend-core';
import { Download, CalendarClock, Rocket, Server } from '@lucide/vue';
import { useUpdateStore } from './update-store';
import VersionSection from './VersionSection.vue';
import AutoCheckSection from './AutoCheckSection.vue';
import UpdateSection from './UpdateSection.vue';
import InstallMethodSection from './InstallMethodSection.vue';

// Version, schedule, update and diagnostics — four sections down one column
// (#267). This was 815 lines in one scroll, the longest page in the app: an
// admin who came to press "update" scrolled past scheduling, and two of the
// blocks folded themselves away to survive it. A fold is a workaround for a
// layout, not a structure (#262).
//
// Unlike the other two pages of the epic the section list is fixed and known
// here, so the key is a literal union with a guard — closest in shape to the
// external-plugins page this all started from.
const SECTIONS = ['version', 'auto', 'update', 'install'] as const;
type Section = (typeof SECTIONS)[number];
const DEFAULT_SECTION: Section = 'version';

const isSection = (value: string): value is Section =>
  SECTIONS.some((candidate) => candidate === value);

const { t } = useI18n();
const route = useRoute();
const store = useUpdateStore();

// The open section is route state: reload, back/forward and a pasted link all
// land on the same section (§5.3 — no hand-rolled `currentTab`).
const sectionQuery = useRouteQuery('section', { default: DEFAULT_SECTION });
const section = computed<Section>(() =>
  isSection(sectionQuery.value) ? sectionQuery.value : DEFAULT_SECTION,
);

// The picker navigates with links, so a section is openable in a new tab —
// which `useRouteQuery`'s writable side (a `replace`) cannot express. The
// default section drops the key, exactly as an assignment would.
const sectionRoute = (value: Section): RouteLocationRaw => {
  const query = { ...route.query };
  if (value === DEFAULT_SECTION) delete query['section'];
  else query['section'] = value;
  return { query };
};

const items = computed<SectionNavItem<Section>[]>(() => [
  {
    key: 'version',
    label: t('settings.updates.sections.version.title'),
    description: t('settings.updates.sections.version.description'),
    to: sectionRoute('version'),
    icon: Download,
    // The one fact this page exists to surface has to be legible from any
    // section — including the diagnostics an admin opened it at.
    badge: store.updateAvailable ? 1 : 0,
    badgeLabel: store.updateAvailable
      ? t('settings.updates.sections.attention')
      : undefined,
  },
  {
    key: 'auto',
    label: t('settings.updates.sections.auto.title'),
    description: t('settings.updates.sections.auto.description'),
    to: sectionRoute('auto'),
    icon: CalendarClock,
  },
  {
    key: 'update',
    label: t('settings.updates.sections.update.title'),
    description: t('settings.updates.sections.update.description'),
    to: sectionRoute('update'),
    icon: Rocket,
  },
  {
    key: 'install',
    label: t('settings.updates.sections.install.title'),
    description: t('settings.updates.sections.install.description'),
    to: sectionRoute('install'),
    icon: Server,
  },
]);

// The fetches live here, not in the sections: the picker's badge has to be
// right on a page opened at any section, and the update pane needs the
// detected install method the diagnostics pane shows.
onMounted(() => {
  store.refresh();
  store.refreshInstallInfo();
  store.refreshDeployHook();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('settings.updates.title')"
      :subtitle="$t('settings.updates.subtitle')"
      :icon="Download"
    />

    <div class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SectionNav
        :items="items"
        :active-key="section"
        :aria-label="$t('settings.updates.sections.ariaLabel')"
        class="lg:sticky lg:top-6 lg:self-start"
      />

      <div class="min-w-0">
        <!-- Kept alive, not rebuilt: a typed-but-unsaved hook URL must survive
             a look at the install diagnostics. -->
        <KeepAlive>
          <VersionSection v-if="section === 'version'" />
          <AutoCheckSection v-else-if="section === 'auto'" />
          <UpdateSection v-else-if="section === 'update'" />
          <InstallMethodSection v-else />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
