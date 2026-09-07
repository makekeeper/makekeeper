<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  Button,
  LanguageSelect,
  Modal,
  TelemetryPayloadList,
  useSessionStore,
  useTelemetryStore,
  useToastStore,
} from '@makekeeper/frontend-core';

// The one-time consent dialog for liveness telemetry (#343).
//
// Asked once per INSTANCE, not per install: an instance that has been running
// for a year meets this question on the first login after the update that
// introduced it, exactly like a fresh one. `prompted` on the server is what
// makes it one-time — a per-browser flag would ask every admin again and would
// forget the moment someone cleared their site data.
//
// Closing without choosing is NOT a refusal. It records only that the question
// was put, leaves the answer at "unasked" — which sends exactly as much as
// "no", i.e. nothing — and never comes back. The switch in Settings → About →
// Counting this instance is the way in for anyone who wants to say yes later.
const session = useSessionStore();
const telemetry = useTelemetryStore();
const toast = useToastStore();
const { t } = useI18n();

// Admin-only, because the answer is about the installation. In single-user mode
// the sole user is the admin, so this is a no-op there.
const mayDecide = computed(() => !session.multiuserEnabled || session.isAdmin);

const open = ref(false);

// One load per genuine change of circumstance. `onMounted` and the session
// watcher below both have to call this — a session that resolves after mount is
// the normal case, and a dialog that only appeared for an already-resolved
// session would miss most logins — but they fired a second identical request on
// every load. The guard keeps the trigger and drops the duplicate.
let loading = false;

const load = async (): Promise<void> => {
  if (loading || open.value) return;
  if (!mayDecide.value) return;
  if (session.multiuserEnabled && !session.isAuthenticated) return;
  loading = true;
  try {
    await telemetry.load();
    if (!telemetry.shouldPrompt) return;
    await telemetry.loadPreview();
    open.value = true;
  } finally {
    loading = false;
  }
};

onMounted(load);
// A session that resolves late (or an admin signing in) still gets asked.
watch(() => [session.isAuthenticated, session.isAdmin], load);

const decide = async (granted: boolean): Promise<void> => {
  try {
    await telemetry.decide(granted);
  } catch (err) {
    // The dialog stays open: closing it on a failed write would leave the
    // question unanswered on the server while looking answered here, and it is
    // asked exactly once.
    toast.error(apiErrorMessage(err, t('telemetry.consent.saveFailed')));
    return;
  }
  open.value = false;
};

// The dialog is dismissible, and dismissal has to be a real answer to "have we
// asked?" — otherwise it reopens on the next page load. Bound to `close` only:
// `Modal` emits `update:modelValue` and `close` for one dismissal, so listening
// to both sent the POST twice.
const dismiss = async (): Promise<void> => {
  open.value = false;
  await telemetry.markPrompted();
};
</script>

<template>
  <Modal
    :model-value="open"
    width="2xl"
    :title="$t('telemetry.consent.title')"
    @close="dismiss"
  >
    <!-- The language picker, repeated from the header: this dialog is the first
         thing a fresh install shows, it covers the header that would otherwise
         be the way to switch, and it is asking for a decision — which nobody
         should have to make in a language they do not read. -->
    <template #headerActions>
      <LanguageSelect />
    </template>

    <div class="space-y-4">
      <p class="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {{ $t('telemetry.consent.body') }}
      </p>

      <!-- Its own paragraph, and its own key: the promise that this is off
           until you say otherwise, and where to undo it, is a different
           statement from what the feature does — a blank line between them is
           structure, and structure is the component's, not a "\n" a locale
           value would have to carry. -->
      <p class="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {{ $t('telemetry.consent.control') }}
      </p>

      <div class="glass-card rounded-2xl p-4">
        <p
          class="mb-3 text-xxs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          {{ $t('telemetry.consent.payloadTitle') }}
        </p>
        <TelemetryPayloadList :payload="telemetry.preview" />
      </div>
    </div>

    <template #footer>
      <!-- Accepting is the accented action, the way the confirming action is
           accented in every other dialog here — a dialog whose two buttons look
           identical reads as unfinished, and the reader has to parse both to
           find the one that proceeds. Refusing stays a full button beside it,
           never a link or a muted afterthought: emphasis is allowed to say
           which answer we hope for, and not allowed to make the other one
           harder to find. Nothing is pre-selected, and there is no third
           "remind me later" — the question is asked once. -->
      <Button
        variant="secondary"
        :disabled="telemetry.busy"
        @click="decide(false)"
      >
        {{ $t('telemetry.consent.decline') }}
      </Button>
      <Button
        variant="primary"
        :disabled="telemetry.busy"
        @click="decide(true)"
      >
        {{ $t('telemetry.consent.accept') }}
      </Button>
    </template>
  </Modal>
</template>
