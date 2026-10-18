<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bell, ChevronRight, MessageSquare, Radio, Star } from '@lucide/vue';
import {
  apiErrorMessage,
  Button,
  Switch,
  useSessionStore,
  useTelemetryStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import SectionShell from './SectionShell.vue';
import { FEEDBACK_LINKS, FEEDBACK_TRAILS } from './feedback';
import { updateSectionRoute } from './updates-sections';

// "Let us know you're here" (#367-#369) — the permanent home of the question
// the dashboard card asks. Different signals, never summed: a star is
// sympathy, a release subscription is engagement, a wish or a complaint is
// direction, the ping is a live instance. Same rows, same order as the card.
// Only the ping needs no GitHub account, which many self-hosters do not have,
// so each row says what it needs and none of them is presented as required.
const { t } = useI18n();
const telemetry = useTelemetryStore();
const session = useSessionStore();
const toast = useToastStore();

// The ping row is instance consent: the telemetry API is admin-only, and a
// regular user in multi-user mode is not asked to decide for the instance.
const mayDecide = computed(() => !session.multiuserEnabled || session.isAdmin);

onMounted(() => {
  if (mayDecide.value && telemetry.state === null) void telemetry.load();
});

// A build with no receiver (a fork that blanked the endpoint) has no ping to
// offer, so the row is not shown rather than shown disabled.
const showPing = computed(
  () =>
    mayDecide.value &&
    telemetry.state !== null &&
    telemetry.state.endpointConfigured,
);

// The same switch as Settings → Counting this instance, through the same store:
// one source of truth for consent, wherever it is changed from.
const pingEnabled = computed({
  get: () => telemetry.enabled,
  set: (value: boolean) => void savePing(value),
});

async function savePing(value: boolean): Promise<void> {
  try {
    await telemetry.decide(value);
  } catch (err) {
    toast.error(
      apiErrorMessage(err, t('settings.updates.counting.saveFailed')),
    );
  }
}

const countingRoute = updateSectionRoute('counting');
</script>

<template>
  <SectionShell
    id="hello"
    :title="$t('settings.about.hello.title')"
    :description="$t('settings.about.hello.description')"
  >
    <ul
      class="glass-card divide-y divide-slate-200/70 rounded-2xl dark:divide-white/5"
    >
      <li class="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <Star
          class="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1 basis-56">
          <p class="text-sm font-semibold text-slate-900 dark:text-white">
            {{ $t('settings.about.hello.star.title') }}
          </p>
          <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {{ $t('settings.about.hello.star.hint') }}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          :icon-left="Star"
          :href="FEEDBACK_LINKS.source"
        >
          {{ $t('settings.about.hello.star.action') }}
        </Button>
      </li>

      <li class="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <Bell
          class="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1 basis-56">
          <p class="text-sm font-semibold text-slate-900 dark:text-white">
            {{ $t('settings.about.hello.follow.title') }}
          </p>
          <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {{ $t('settings.about.hello.follow.hint') }}
          </p>
          <!-- GitHub's own menu names, step by step. The chevrons are framing
               the component owns, not punctuation in a locale value (§5.4). -->
          <p
            class="mt-2 flex flex-wrap items-center gap-1 text-xxs text-slate-500 dark:text-slate-400"
          >
            <template v-for="(step, i) in FEEDBACK_TRAILS.follow" :key="step">
              <ChevronRight
                v-if="i > 0"
                class="h-3 w-3 shrink-0 opacity-60"
                aria-hidden="true"
              />
              <span>{{ step }}</span>
            </template>
          </p>
          <Button
            class="mt-1"
            size="sm"
            variant="link"
            :href="FEEDBACK_LINKS.releasesFeed"
          >
            {{ $t('settings.about.hello.follow.feed') }}
          </Button>
        </div>
        <Button
          size="sm"
          variant="secondary"
          :icon-left="Bell"
          :href="FEEDBACK_LINKS.source"
        >
          {{ $t('settings.about.hello.follow.action') }}
        </Button>
      </li>

      <!-- The card's "Share your thoughts" lands on this page, so the wish or
           complaint it asks for needs a row of its own here. It opens the same
           Ideas form as "Suggest an improvement" above; a defect is steered to
           the bug report there, which carries the environment. -->
      <li class="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <MessageSquare
          class="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1 basis-56">
          <p class="text-sm font-semibold text-slate-900 dark:text-white">
            {{ $t('settings.about.hello.feedback.title') }}
          </p>
          <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {{ $t('settings.about.hello.feedback.hint') }}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          :icon-left="MessageSquare"
          :href="FEEDBACK_LINKS.ideas"
        >
          {{ $t('settings.about.hello.feedback.action') }}
        </Button>
      </li>

      <li
        v-if="showPing"
        class="flex flex-wrap items-center gap-x-4 gap-y-3 p-4"
      >
        <Radio
          class="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1 basis-56">
          <p class="text-sm font-semibold text-slate-900 dark:text-white">
            {{ $t('settings.about.hello.ping.title') }}
          </p>
          <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {{ $t('settings.about.hello.ping.hint') }}
          </p>
          <Button class="mt-1" size="sm" variant="link" :to="countingRoute">
            {{ $t('settings.about.hello.ping.details') }}
          </Button>
        </div>
        <Switch
          v-model="pingEnabled"
          :disabled="telemetry.busy"
          :aria-label="$t('settings.about.hello.ping.title')"
        />
      </li>
    </ul>
  </SectionShell>
</template>
