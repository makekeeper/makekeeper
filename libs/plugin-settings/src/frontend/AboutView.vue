<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  PageHeader,
  SectionNav,
  useSessionStore,
} from '@makekeeper/frontend-core';
import { Info } from '@lucide/vue';
import AboutSection from './AboutSection.vue';
import { useUpdateStore } from './update-store';
import { buildUpdatesNav, type UpdatesNavKey } from './updates-sections';

// About is a page, not a query of the update page (#342): the update page is
// `meta.adminOnly` instance administration, and the one surface a user needs in
// order to reach us must not be behind that gate. It wears the same section
// picker, so from the reader's side it IS the first section of that page.
const { t } = useI18n();
const route = useRoute();
const store = useUpdateStore();
const session = useSessionStore();

// A regular user in multi-user mode gets a one-row picker: the rows they cannot
// open are not shown at all rather than shown and bouncing.
const canAdminister = computed(
  () => !session.multiuserEnabled || session.isAdmin,
);

const items = computed(() =>
  buildUpdatesNav({
    query: route.query,
    t,
    updateAvailable: store.updateAvailable,
    includeAdminSections: canAdminister.value,
  }),
);

const active: UpdatesNavKey = 'about';

// The version summary is public and already loaded by the shell; the install
// method is not, and the store's own admin gate decides whether the request
// fires at all.
onMounted(() => {
  store.refresh();
  store.refreshInstallInfo();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('settings.about.title')"
      :subtitle="$t('settings.about.subtitle')"
      :icon="Info"
    />

    <div class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SectionNav
        :items="items"
        :active-key="active"
        :aria-label="$t('settings.updates.sections.ariaLabel')"
        class="lg:sticky lg:top-6 lg:self-start"
      />

      <div class="min-w-0">
        <AboutSection />
      </div>
    </div>
  </div>
</template>
