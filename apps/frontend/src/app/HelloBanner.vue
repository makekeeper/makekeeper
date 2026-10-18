<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bell, Hand, MessageSquare, Radio, Star, X } from '@lucide/vue';
import {
  apiErrorMessage,
  Button,
  Tooltip,
  useSessionStore,
  useTelemetryStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import { PRODUCT_REPO_URL } from '@makekeeper/plugin-contract';
import { useHelloStore } from '../stores/hello';

// "Let us know you're here" (#367): asked a week after the instance first met
// the feature, of every signed-in person (#368) — a star or a release
// subscription is a personal act, so five people on one instance are five
// signals. Each closes it for themselves. Any one signal is enough, and the
// card says so instead of reading as a checklist.
//
// It sits where the demo banner sits (variant A of the prototype): inside the
// content column, above the view. It describes the instance, it does not
// interrupt the page.
const { t } = useI18n();
const hello = useHelloStore();
const telemetry = useTelemetryStore();
const session = useSessionStore();
const toast = useToastStore();

// The ping is the one instance-level action on the card: consent to send for
// the whole instance, so it is offered only to whoever may act for it — the
// same gate as the telemetry question. With the multiuser overlay off there is
// no session at all and a single-user instance is its own admin.
const mayDecide = computed(() => !session.multiuserEnabled || session.isAdmin);
// Nothing authenticated is fetched before there is a session to fetch it with
// (§5.8), and the fetch fires as soon as there is one.
const canAsk = computed(
  () => !session.multiuserEnabled || session.isAuthenticated,
);

watch(
  canAsk,
  (allowed) => {
    if (allowed) void hello.load();
  },
  { immediate: true },
);

// The ping is only worth offering where it can be turned on and is not on yet.
// The telemetry state is read only once the card is due — not on every load of
// every page for an answer nobody will see.
watch(
  () => hello.show && mayDecide.value,
  (due) => {
    if (due && telemetry.state === null) void telemetry.load();
  },
  { immediate: true },
);
const offerPing = computed(
  () =>
    mayDecide.value &&
    telemetry.state !== null &&
    telemetry.state.endpointConfigured &&
    !telemetry.enabled,
);

// Not a switch flipped from the dashboard: consent to send something deserves
// the page that shows exactly what is sent. The card takes the user there, by
// route name like the sidebar's version link, so a moved path cannot strand it.
const pingRoute = {
  name: 'settings-updates',
  query: { section: 'counting' },
};

// The text asks for wishes and complaints, so the card needs somewhere to send
// them: Settings → About, whose first block is exactly that — report a
// problem, suggest an improvement, ask a question. Open to everyone, unlike
// the ping. By name, like the ping link.
const feedbackRoute = { name: 'settings-about' };

const visible = computed(() => canAsk.value && hello.show);

const dismiss = async (): Promise<void> => {
  try {
    await hello.dismiss();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('hello.banner.dismissFailed')));
  }
};
</script>

<template>
  <!-- `relative overflow-hidden` holds the shine inside the rounded card. The
       tooltip on the close is teleported, so the clip cannot cut it. `group`
       lets the two moving parts stop together while the pointer or the focus
       is on the card: a loop longer than 5 s must be pausable (WCAG 2.2.2),
       and someone reaching for a button should not chase a moving target. -->
  <div
    v-if="visible"
    class="group relative mb-6 flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border border-brand-500/30 bg-brand-50/70 dark:bg-brand-400/10 p-4"
  >
    <!-- To draw the eye (#369): the hand waves, then a band of light crosses
         the card, on one shared cycle, for as long as the card is shown.
         Decoration only — hidden from assistive tech, never in the way of a
         click — and `motion-safe:` keeps it still for anyone who asked their
         system for less motion; parked off-card, the band is then invisible. -->
    <span
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 -translate-x-full bg-hello-shine dark:bg-hello-shine-dark motion-safe:animate-hello-sweep group-hover:paused group-focus-within:paused"
    />
    <!-- Same icon-in-a-tile as the demo banner: the text is two lines, and a
         loose glyph pinned to the first would leave the row hanging. -->
    <span
      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400"
    >
      <Hand
        class="h-5 w-5 origin-hello-hand motion-safe:animate-hello-wave group-hover:paused group-focus-within:paused"
        aria-hidden="true"
      />
    </span>
    <div class="min-w-0 flex-1 basis-64">
      <!-- One step above the demo notice's sizes: this card is a personal
           note from the developer, and a request reads better than small
           print. -->
      <p class="text-base font-medium text-slate-800 dark:text-slate-100">
        {{ t('hello.banner.title') }}
      </p>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ t('hello.banner.body') }}
      </p>
    </div>
    <!-- The actions travel together and wrap as a group. Up to four buttons,
         not the demo banner's two: the group must be allowed to shrink
         (min-w-0, no shrink-0), or it overflows the card instead of wrapping
         and pushes the close cross out of a narrow column. -->
    <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant="secondary"
        :icon-left="Star"
        :href="PRODUCT_REPO_URL"
      >
        {{ t('hello.banner.star') }}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        :icon-left="Bell"
        :href="PRODUCT_REPO_URL"
      >
        {{ t('hello.banner.follow') }}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        :icon-left="MessageSquare"
        :to="feedbackRoute"
      >
        {{ t('hello.banner.feedback') }}
      </Button>
      <Button
        v-if="offerPing"
        size="sm"
        variant="secondary"
        :icon-left="Radio"
        :to="pingRoute"
      >
        {{ t('hello.banner.ping') }}
      </Button>
      <!-- The close is final for this person, which a bare cross does not
           say — a cross usually means "not now". The tooltip says it out loud
           for a sighted user; the aria-label already did for the rest. -->
      <Tooltip :text="t('hello.banner.dismiss')" size="sm">
        <Button
          size="icon-sm"
          variant="ghost"
          :icon-left="X"
          :loading="hello.dismissing"
          :aria-label="t('hello.banner.dismiss')"
          @click="dismiss"
        />
      </Tooltip>
    </div>
  </div>
</template>
