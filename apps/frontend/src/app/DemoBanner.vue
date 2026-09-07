<script setup lang="ts">
import { computed, watch } from 'vue';
import { FlaskConical, X } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { ref } from 'vue';
import {
  BusyOverlay,
  Button,
  getErrorMessage,
  useConfirm,
  useSessionStore,
  useToastStore,
  notifyAgentDataChanged,
} from '@makekeeper/frontend-core';
import { storeToRefs } from 'pinia';
import { DEMO_CLEAR_INCOMPLETE, useDemoStore } from '../stores/demo';

// The notice a first install wakes up with (#339): the workshop on screen is a
// demo, and here is the one action that turns it into an empty instance.
//
// It sits inside the content column rather than over it: this is information
// about what is on the page, not an interruption. Dismissal is per-browser
// (see the store); clearing is instance state, so it is offered to whoever may
// act for the whole instance — see `canClear`.
const { t } = useI18n();
const demo = useDemoStore();
const { showBanner, clearing } = storeToRefs(demo);
const session = useSessionStore();
const toast = useToastStore();
const confirm = useConfirm();

// Who may empty the instance. With the multiuser overlay off there is no
// session at all and `isAdmin` is false for everyone — a single-user instance
// is its own admin, and gating on the role alone hid the only way out of the
// demo data on exactly the install this feature exists for.
const canClear = computed(() => !session.multiuserEnabled || session.isAdmin);

// `/api/demo` is an authenticated route. Asking for it before the user has
// signed in returns 401 and — since the banner asked exactly once, on mount —
// the notice then never appeared for the session that followed. The shell's own
// rule applies here too: no authenticated call until there is someone to make
// it for (CLAUDE.md §5.8), and one as soon as there is.
const canUseAuthedApi = computed(
  () => !session.multiuserEnabled || session.isAuthenticated,
);

watch(
  canUseAuthedApi,
  (allowed) => {
    if (allowed) void demo.load();
  },
  { immediate: true },
);

// A blocking wait, not a button spinner: what is being removed is on the
// screen behind, and letting someone open a project mid-delete gives them a
// page of rows that are already gone.
const removing = ref(false);

// The removal itself is quick, but "it blinked and the screen changed" reads as
// a glitch for an action this final. The floor is a minimum, never a fake
// progress bar — the wait ends when the server has confirmed the rows are gone,
// and a bar that pretended to track that would be lying the moment it failed.
const MIN_VISIBLE_MS = 1800;

const clear = async (): Promise<void> => {
  const confirmed = await confirm({
    title: t('demo.clear.title'),
    message: t('demo.clear.message'),
    confirmLabel: t('demo.clear.confirm'),
    tone: 'danger',
  });
  if (!confirmed) return;

  removing.value = true;
  const startedAt = Date.now();
  try {
    const { removed } = await demo.clear();
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_VISIBLE_MS) {
      await new Promise((done) => setTimeout(done, MIN_VISIBLE_MS - elapsed));
    }
    toast.success(t('demo.clear.done', { count: removed }));
    // Every open screen is now showing rows that no longer exist. The signal
    // reaches views built on `useResource`; the ones with their own fetching do
    // not hear it, and a page still listing deleted rows was the bug reported
    // here. After removing the entire dataset the whole client is stale, so the
    // honest move is to start it again rather than to chase every screen.
    notifyAgentDataChanged();
    window.location.reload();
  } catch (err) {
    removing.value = false;
    toast.error(
      getErrorMessage(err) === DEMO_CLEAR_INCOMPLETE
        ? t('demo.clear.incomplete')
        : getErrorMessage(err) || t('demo.clear.failed'),
    );
  }
};
</script>

<template>
  <BusyOverlay :show="removing" :label="$t('demo.clear.progress')" />

  <div
    v-if="showBanner"
    class="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-50/80 dark:bg-amber-400/10 p-4"
  >
    <!-- The mark is a tinted square rather than a loose glyph: the text beside
         it is two lines, and a 20px icon pinned to the first one left the row
         looking hung from its top edge. At the height of both lines it has
         something to centre against, and it is the same icon-in-a-tile the
         chat header already uses. -->
    <span
      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400"
    >
      <FlaskConical class="h-5 w-5" aria-hidden="true" />
    </span>
    <div class="min-w-0 flex-1 basis-64">
      <p class="text-sm font-medium text-slate-800 dark:text-slate-100">
        {{ t('demo.banner.title') }}
      </p>
      <p class="mt-1 text-xs text-slate-600 dark:text-slate-400">
        {{ t('demo.banner.body') }}
      </p>
    </div>
    <!-- The actions travel together: when the column is too narrow for text
         and buttons on one line, they wrap as a pair rather than the dismiss
         cross alone dropping to a line of its own. -->
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Button
        v-if="canClear"
        size="sm"
        variant="danger"
        :loading="clearing"
        @click="clear"
      >
        {{ t('demo.banner.clear') }}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        :icon-left="X"
        :aria-label="t('demo.banner.dismiss')"
        @click="demo.dismiss()"
      />
    </div>
  </div>
</template>
