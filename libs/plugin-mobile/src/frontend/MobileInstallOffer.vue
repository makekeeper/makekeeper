<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button, useToastStore } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Download } from '@lucide/vue';
import type { MobileOriginVerdict } from '@makekeeper/plugin-contract';
import {
  fetchOriginInfo,
  installPromptAvailable,
  isStandalone,
  promptInstall,
} from './install';

// "Put this on the home screen" (#210). It lives next to the pairing actions
// because that is the moment installing is worth doing: an installed app has its
// own storage — on iOS deliberately apart from the tab it was installed from —
// so the honest order is install FIRST, then pair the app that will keep the
// credential.
//
// The offer is not administered by anyone. Nobody is prevented from putting a
// shortcut on their own phone, so the only thing worth gating on is whether an
// installed app can exist at this address at all; where it can exist but will
// not last, the surface says so and lets the person decide.

const { t } = useI18n();
const toast = useToastStore();

// Read once: whether this document is the installed app is a property of how it
// was launched, and cannot change while it runs.
const standalone = isStandalone();
const verdict = ref<MobileOriginVerdict | null>(null);

onMounted(async () => {
  try {
    verdict.value = (await fetchOriginInfo()).verdict;
  } catch {
    // Not knowing the address means making no claims about it: silence beats an
    // instruction we cannot stand behind.
    verdict.value = null;
  }
});

// Already an app — there is nothing left to offer.
const shown = computed<boolean>(() => !standalone && verdict.value !== null);

// Chromium hands us a prompt; everywhere else the browser's own menu is the only
// way in, so the offer becomes an instruction instead of a button.
const canPrompt = computed<boolean>(
  () => installPromptAvailable.value !== null,
);

// A throwaway tunnel installs perfectly well and stops working on the next
// restart. That is a warning, not a veto.
const warningKey = computed<string | null>(() =>
  verdict.value === 'ephemeral-host' ? 'mobile.install.ephemeralHost' : null,
);

const install = async (): Promise<void> => {
  const outcome = await promptInstall();
  if (outcome === 'accepted') toast.success(t('mobile.install.accepted'));
};
</script>

<template>
  <section
    v-if="shown"
    class="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-4 space-y-3"
  >
    <p class="font-semibold text-sm">{{ $t('mobile.install.title') }}</p>

    <!-- Plain http off loopback: the browser refuses the service worker and the
         camera, so there is nothing to offer and every reason to say why. -->
    <p
      v-if="verdict === 'insecure'"
      class="text-sm text-slate-600 dark:text-slate-300"
    >
      {{ $t('mobile.install.insecure') }}
    </p>

    <template v-else>
      <p class="text-sm text-slate-600 dark:text-slate-300">
        {{ $t('mobile.install.offer') }}
      </p>
      <p v-if="warningKey" class="text-xs text-amber-700 dark:text-amber-300">
        {{ $t(warningKey) }}
      </p>
      <Button
        v-if="canPrompt"
        variant="secondary"
        block
        :icon-left="Download"
        @click="install"
      >
        {{ $t('mobile.install.action') }}
      </Button>
      <p v-else class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('mobile.install.manual') }}
      </p>
    </template>
  </section>
</template>
