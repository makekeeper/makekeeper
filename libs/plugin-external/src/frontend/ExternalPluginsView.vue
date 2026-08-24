<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { Blocks, KeyRound, Radar, Timer } from '@lucide/vue';
import {
  PageHeader,
  SectionNav,
  useRouteQuery,
  type SectionNavItem,
} from '@makekeeper/frontend-core';
import { provideExternalAdmin } from './external-admin';
import ConnectSection from './ConnectSection.vue';
import ConnectedSection from './ConnectedSection.vue';
import BudgetsSection from './BudgetsSection.vue';
import TokensSection from './TokensSection.vue';

// Admin surface of the external-plugins host (#133): install-token generation,
// the consent card for pending installs / permission-expanding updates, and
// lifecycle actions. A Settings-hub guest tab, admin-only under multiuser.
//
// Four sections down one column, one of them open at a time (#262). It used to
// be one page-long scroll, with the tuning surfaces folded away to survive it —
// a fold is a workaround for a layout, not a structure.
const SECTIONS = ['connect', 'settings', 'tokens', 'connected'] as const;
type Section = (typeof SECTIONS)[number];
const DEFAULT_SECTION: Section = 'connected';

const isSection = (value: string): value is Section =>
  SECTIONS.some((candidate) => candidate === value);

const { t } = useI18n();
const route = useRoute();
const admin = provideExternalAdmin();

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

// A section that is not open still has to be able to ask for attention: an
// install waiting for consent is invisible otherwise. The count carries its
// meaning with it — on its own it is announced as "Connect 2".
const attention = (count: number): string | undefined =>
  count > 0 ? t('external.sections.attention', { count }) : undefined;

const items = computed<SectionNavItem<Section>[]>(() => [
  {
    key: 'connect',
    label: t('external.sections.connect.title'),
    description: t('external.sections.connect.description'),
    to: sectionRoute('connect'),
    icon: Radar,
    badge: admin.pairing.value.knocking + admin.awaitingApproval.value.length,
    badgeLabel: attention(
      admin.pairing.value.knocking + admin.awaitingApproval.value.length,
    ),
  },
  {
    key: 'settings',
    label: t('external.sections.settings.title'),
    description: t('external.sections.settings.description'),
    to: sectionRoute('settings'),
    icon: Timer,
  },
  {
    key: 'tokens',
    label: t('external.sections.tokens.title'),
    description: t('external.sections.tokens.description'),
    to: sectionRoute('tokens'),
    icon: KeyRound,
  },
  {
    key: 'connected',
    label: t('external.sections.connected.title'),
    description: t('external.sections.connected.description'),
    to: sectionRoute('connected'),
    icon: Blocks,
    badge: admin.pendingUpdates.value,
    badgeLabel: attention(admin.pendingUpdates.value),
  },
]);

// The poll lives here, not in the Connect section: the picker's badge has to
// keep counting while another section is open.
let discoveryTimer: number | undefined;

onMounted(async () => {
  await admin.load();
  await admin.loadDiscovery();
  discoveryTimer = window.setInterval(() => void admin.loadDiscovery(), 4000);
});
onBeforeUnmount(() => window.clearInterval(discoveryTimer));
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('external.title')"
      :subtitle="t('external.subtitle')"
      :icon="Blocks"
    />

    <div class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SectionNav
        :items="items"
        :active-key="section"
        :aria-label="t('external.sections.ariaLabel')"
        class="lg:sticky lg:top-6 lg:self-start"
      />

      <div class="min-w-0">
        <!-- Kept alive, not rebuilt: switching sections used to throw away a
             half-edited budget form and re-fetch everything on the way back. -->
        <KeepAlive>
          <ConnectSection v-if="section === 'connect'" />
          <BudgetsSection v-else-if="section === 'settings'" />
          <TokensSection
            v-else-if="section === 'tokens'"
            :connect-to="sectionRoute('connect')"
          />
          <ConnectedSection v-else :connect-to="sectionRoute('connect')" />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
