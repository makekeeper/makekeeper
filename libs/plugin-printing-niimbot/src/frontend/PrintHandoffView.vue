<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Button, Spinner, apiJson } from '@makekeeper/frontend-core';
import {
  decodeRasterPayload,
  rasterPixel,
  type PrintProgress,
  type PrintRaster,
  type PrintRasterPayload,
} from '@makekeeper/plugin-contract';
import { Printer } from '@lucide/vue';
import { isBleSupported, printRaster } from './niimbot-driver';

// The handoff page (#361): a browser standing near the printer opens this link
// and prints one label, with no login.
//
// Mounted without the app shell (`meta.fullscreen` + `public`), the capture
// phone-surface pattern: there is no session here, and the token in the URL is
// the whole authority. What it unlocks is one parked raster — no object, no
// name, no label code — so the page can show the person exactly what they are
// about to print and nothing else.
//
// The link carries the desktop's language as `?lang` (#211) and the app shell
// resolves it before mounting (`resolveInitialLocale`), so this page needs no
// locale code of its own — it just reads the words it was given.
const route = useRoute();
const { t } = useI18n();

const token = computed<string>(() => String(route.params.token ?? ''));

const state = ref<'loading' | 'ready' | 'gone' | 'printing' | 'printed'>(
  'loading',
);
const raster = ref<PrintRaster | null>(null);
const copies = ref(1);
const progress = ref<PrintProgress | null>(null);
const errorKey = ref('');
const errorParams = ref<Record<string, string | number>>({});
const preview = ref<HTMLCanvasElement | null>(null);

const load = async (): Promise<void> => {
  state.value = 'loading';
  try {
    const payload = await apiJson<PrintRasterPayload>(
      `/api/printing-niimbot/handoff/${encodeURIComponent(token.value)}`,
      { public: true },
    );
    const page = decodeRasterPayload(payload);
    // A payload that is not a page is the same dead end as a spent token: the
    // one thing this screen must never do is offer to print half a label.
    if (!page) {
      state.value = 'gone';
      return;
    }
    raster.value = page;
    copies.value = payload.copies;
    state.value = 'ready';
  } catch {
    // Expired, spent, exhausted or never existed — the server deliberately does
    // not distinguish, and neither does this page.
    state.value = 'gone';
  }
};

onMounted(load);

// The preview is the raster itself, dot for dot — the honest answer to "what
// will come out", and the only thing this page is allowed to know.
watch([raster, preview], () => {
  const page = raster.value;
  const canvas = preview.value;
  if (!page || !canvas) return;
  canvas.width = page.widthDots;
  canvas.height = page.heightDots;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(page.widthDots, page.heightDots);
  for (let y = 0; y < page.heightDots; y += 1) {
    for (let x = 0; x < page.widthDots; x += 1) {
      const ink = rasterPixel(page, x, y);
      const i = (y * page.widthDots + x) * 4;
      const value = ink ? 0 : 255;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
});

const print = async (): Promise<void> => {
  const page = raster.value;
  if (!page || state.value === 'printing') return;
  state.value = 'printing';
  errorKey.value = '';
  errorParams.value = {};
  progress.value = null;
  const result = await printRaster(page, { copies: copies.value }, (update) => {
    progress.value = update;
  });
  progress.value = null;
  if (!result.ok) {
    errorKey.value = result.errorKey;
    errorParams.value = result.params ?? {};
    // A failed connection must NOT cost the link: the same token still works,
    // which is why the server counts attempts instead of opens.
    state.value = 'ready';
    return;
  }
  // Paper exists, so the token is spent. A failure to report it only means the
  // link outlives the label it printed until its TTL — not worth troubling the
  // person who is holding the sticker.
  await apiJson(
    `/api/printing-niimbot/handoff/${encodeURIComponent(token.value)}/printed`,
    { method: 'POST', public: true },
  ).catch(() => undefined);
  state.value = 'printed';
};

const unsupported = computed<boolean>(() => !isBleSupported());
</script>

<template>
  <main
    class="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 p-6 text-slate-900 dark:bg-dark-900 dark:text-white"
  >
    <h1 class="text-lg font-bold">{{ $t('printingNiimbot.handoff.title') }}</h1>

    <Spinner v-if="state === 'loading'" />

    <p
      v-else-if="state === 'gone'"
      class="max-w-sm rounded-2xl bg-white p-4 text-center text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300"
    >
      {{ $t('printingNiimbot.handoff.gone') }}
    </p>

    <template v-else>
      <!-- What will come out, dot for dot. Always on white: it is paper. -->
      <div class="rounded-2xl bg-white p-3 shadow-sm dark:shadow-black/40">
        <!-- `role="img"`: a canvas has no role of its own, so an aria-label on
             it alone is not announced. -->
        <canvas
          ref="preview"
          role="img"
          class="h-auto w-full max-w-[320px]"
          :aria-label="$t('printingNiimbot.handoff.previewLabel')"
        />
      </div>

      <p
        v-if="unsupported"
        class="max-w-sm rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
      >
        {{ $t('printingNiimbot.handoff.unsupported') }}
      </p>

      <Button
        v-else-if="state !== 'printed'"
        variant="primary"
        :icon-left="Printer"
        :loading="state === 'printing'"
        @click="print"
      >
        {{ $t('printingNiimbot.handoff.action') }}
      </Button>

      <p
        v-if="progress"
        class="text-xs text-slate-500 dark:text-slate-400"
        aria-live="polite"
      >
        {{
          $t(`printingNiimbot.handoff.stage.${progress.stage}`, {
            done: progress.rowsDone,
            total: progress.rowsTotal,
          })
        }}
      </p>

      <p
        v-if="state === 'printed'"
        class="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
      >
        {{ $t('printingNiimbot.handoff.done') }}
      </p>

      <p
        v-if="errorKey"
        class="max-w-sm text-center text-sm text-red-600 dark:text-red-400"
        role="alert"
      >
        {{ t(errorKey, errorParams) }}
      </p>
    </template>
  </main>
</template>
