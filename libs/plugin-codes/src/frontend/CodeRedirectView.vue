<script setup lang="ts">
// Label deep-link landing (#74): the `/c/:code` public route. Resolves the short
// code to the object it names and redirects to that object's in-app route. Public
// + fullscreen — a phone's native camera opens it with no app chrome. An unknown
// code shows a small not-found panel instead of a dead redirect.
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { apiFetch, resolveObjectRefRoute } from '@makekeeper/frontend-core';
import { QrCode } from '@lucide/vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

type Phase = 'resolving' | 'notFound';
const phase = ref<Phase>('resolving');
const code = ref<string>('');

onMounted(async () => {
  code.value = String(route.params.code ?? '');
  try {
    const res = await apiFetch(
      `/api/codes/c/${encodeURIComponent(code.value)}`,
    );
    const data: { ref?: string | null } = res.ok
      ? await res.json()
      : { ref: null };
    const target = data.ref ? resolveObjectRefRoute(data.ref) : null;
    if (target) {
      router.replace(target);
      return;
    }
  } catch {
    // fall through to not-found
  }
  phase.value = 'notFound';
});
</script>

<template>
  <div
    class="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center bg-slate-50 dark:bg-dark-950 text-slate-900 dark:text-white"
  >
    <template v-if="phase === 'resolving'">
      <QrCode class="w-10 h-10 text-brand-500 animate-pulse" />
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ t('codes.redirect.resolving') }}
      </p>
    </template>
    <template v-else>
      <QrCode class="w-10 h-10 text-slate-400 dark:text-slate-500" />
      <h1 class="text-lg font-semibold">
        {{ t('codes.redirect.notFound') }}
      </h1>
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ t('codes.redirect.notFoundHint', { code }) }}
      </p>
    </template>
  </div>
</template>
