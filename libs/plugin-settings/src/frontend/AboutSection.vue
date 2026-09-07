<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Bug,
  ChevronRight,
  Lightbulb,
  MessageCircleQuestion,
} from '@lucide/vue';
import {
  Disclosure,
  usePluginsStore,
  useVersionStore,
} from '@makekeeper/frontend-core';
import SectionShell from './SectionShell.vue';
import { useUpdateStore } from './update-store';
import {
  buildBugReportUrl,
  formatEnvironment,
  FEEDBACK_LINKS,
  FEEDBACK_TRAILS,
  type FeedbackEnvironment,
} from './feedback';

// The product's route back to us (#342), and the page that says what the
// product is. It is the base surface: the sidebar and the header menu only
// link here, so there is one place to keep right and one place to name when
// someone asks where to write.
//
// Not admin-only, unlike every sibling section of the update page — which is
// exactly why it is a route of its own (see `updates-sections.ts`).
const { t, locale } = useI18n();
const versionStore = useVersionStore();
const pluginsStore = usePluginsStore();
const updateStore = useUpdateStore();
// Enabled plugins name what the instance actually is. `isEnabled` — the
// EFFECTIVE set for this user, which is what they are looking at and therefore
// what their report is about.
const enabledPlugins = computed<string[]>(() =>
  pluginsStore.plugins.filter((plugin) => plugin.isEnabled).map((p) => p.id),
);

// Admin-only diagnostics (#100): absent for a regular user in multi-user mode,
// and then simply left out of the report rather than guessed at.
const installMethod = computed<string | null>(
  () => updateStore.installInfo?.method ?? null,
);

const installMethodLabel = computed<string | null>(() =>
  installMethod.value
    ? t(`settings.updates.install.methods.${installMethod.value}`)
    : null,
);

const environment = computed<FeedbackEnvironment>(() => ({
  version: versionStore.version,
  installMethod: installMethod.value,
  plugins: enabledPlugins.value,
  locale: locale.value,
}));

// The block the reporter will see in the form, built once and shown verbatim
// below the buttons: what we send must be readable BEFORE it is sent, not
// discovered on GitHub.
const environmentLabels = computed(() => ({
  version: t('settings.about.report.version'),
  installMethod: t('settings.about.report.installMethod'),
  plugins: t('settings.about.report.plugins'),
  locale: t('settings.about.report.locale'),
}));

const bugUrl = computed(() =>
  buildBugReportUrl(environment.value, environmentLabels.value),
);

const environmentPreview = computed(() =>
  formatEnvironment(environment.value, environmentLabels.value),
);

// Folded, because it is read once — but present, because "we fill in some
// details for you" is a claim the user is entitled to check before pressing a
// button that leaves the app (#272 gave us the fold for exactly this shape).
const previewOpen = ref(false);

interface FeedbackAction {
  key: string;
  href: string;
  icon: typeof Bug;
  title: string;
  hint: string;
  destination: readonly string[];
}

const actions = computed<FeedbackAction[]>(() => [
  {
    key: 'bug',
    href: bugUrl.value,
    icon: Bug,
    title: t('settings.about.actions.bug.title'),
    hint: t('settings.about.actions.bug.hint'),
    destination: FEEDBACK_TRAILS.bug,
  },
  {
    key: 'idea',
    href: FEEDBACK_LINKS.ideas,
    icon: Lightbulb,
    title: t('settings.about.actions.idea.title'),
    hint: t('settings.about.actions.idea.hint'),
    destination: FEEDBACK_TRAILS.idea,
  },
  {
    key: 'question',
    href: FEEDBACK_LINKS.questions,
    icon: MessageCircleQuestion,
    title: t('settings.about.actions.question.title'),
    hint: t('settings.about.actions.question.hint'),
    destination: FEEDBACK_TRAILS.question,
  },
]);

// Which action the reader arrived for, named by the sidebar/menu entry that
// sent them here (#342). Read from the route rather than passed as a prop: the
// entries are in the shell, this section is in a plugin, and the route is the
// only thing they share. An unknown or absent value simply highlights nothing.
const route = useRoute();
const requested = computed<string | null>(() => {
  const value = route.query['action'];
  return typeof value === 'string' ? value : null;
});

const links = computed(() => [
  {
    key: 'source',
    href: FEEDBACK_LINKS.source,
    label: t('settings.about.links.source'),
  },
  {
    key: 'install',
    href: FEEDBACK_LINKS.install,
    label: t('settings.about.links.install'),
  },
  {
    key: 'releases',
    href: FEEDBACK_LINKS.releases,
    label: t('settings.about.links.releases'),
  },
  {
    key: 'discussions',
    href: FEEDBACK_LINKS.discussions,
    label: t('settings.about.links.discussions'),
  },
  {
    key: 'license',
    href: FEEDBACK_LINKS.license,
    label: t('settings.about.links.license'),
  },
]);
</script>

<template>
  <SectionShell
    :title="$t('settings.about.contact.title')"
    :description="$t('settings.about.contact.description')"
  >
    <!-- Every button leaves the app, so each says where it lands before it is
         pressed: the destination line is the difference between an invitation
         and a surprise. -->
    <!-- Column-sized, not window-sized: `sm:`/`xl:` ask the viewport, while
         this page narrows on its own when the chat panel opens. `auto-fit`
         reads the space actually available and collapses to one column. -->
    <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
      <a
        v-for="action in actions"
        :key="action.key"
        :href="action.href"
        target="_blank"
        rel="noopener noreferrer"
        class="glass-card flex flex-col gap-2 rounded-2xl p-4 transition-colors hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        :class="
          action.key === requested
            ? 'ring-2 ring-brand-500 border-brand-500/60'
            : ''
        "
      >
        <span class="flex items-center gap-2">
          <component
            :is="action.icon"
            class="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400"
            aria-hidden="true"
          />
          <span class="text-sm font-semibold text-slate-900 dark:text-white">
            {{ action.title }}
          </span>
        </span>
        <span
          class="text-xs leading-relaxed text-slate-600 dark:text-slate-300"
        >
          {{ action.hint }}
        </span>
        <!-- The trail is joined HERE: the separator is framing, and framing
             belongs to the component rather than to three locale values that
             would each have to remember it (§5.4). -->
        <span
          class="mt-auto flex flex-wrap items-center gap-1 text-xxs text-slate-500 dark:text-slate-400"
        >
          <template v-for="(step, i) in action.destination" :key="step">
            <ChevronRight
              v-if="i > 0"
              class="h-3 w-3 shrink-0 opacity-60"
              aria-hidden="true"
            />
            <span>{{ step }}</span>
          </template>
        </span>
      </a>
    </div>

    <Disclosure
      v-model:open="previewOpen"
      variant="inline"
      content-id="about-report-preview"
      :title="$t('settings.about.report.title')"
      :description="$t('settings.about.report.description')"
    >
      <pre
        class="mt-3 overflow-x-auto rounded-xl bg-slate-100 p-4 text-xxs leading-relaxed text-slate-700 dark:bg-white/5 dark:text-slate-200"
        >{{ environmentPreview }}</pre
      >
    </Disclosure>

    <div class="glass-card space-y-4 rounded-2xl p-6">
      <p class="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {{ $t('settings.about.description') }}
      </p>

      <dl class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
        <div v-if="versionStore.version" class="min-w-0">
          <dt
            class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.about.facts.version') }}
          </dt>
          <dd
            class="mt-1 break-words text-sm text-slate-900 dark:text-slate-100"
          >
            {{ versionStore.version }}
          </dd>
        </div>
        <div v-if="installMethodLabel" class="min-w-0">
          <dt
            class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.about.facts.install') }}
          </dt>
          <dd
            class="mt-1 break-words text-sm text-slate-900 dark:text-slate-100"
          >
            {{ installMethodLabel }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt
            class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.about.facts.plugins') }}
          </dt>
          <dd
            class="mt-1 break-words text-sm text-slate-900 dark:text-slate-100"
          >
            {{ enabledPlugins.length }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt
            class="text-xxs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.about.facts.license') }}
          </dt>
          <dd
            class="mt-1 break-words text-sm text-slate-900 dark:text-slate-100"
          >
            {{ $t('settings.about.facts.licenseValue') }}
          </dd>
        </div>
      </dl>

      <div class="flex flex-wrap gap-x-4 gap-y-2">
        <a
          v-for="link in links"
          :key="link.key"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
          class="rounded text-xs font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400"
        >
          {{ link.label }}
        </a>
      </div>
    </div>
  </SectionShell>
</template>
