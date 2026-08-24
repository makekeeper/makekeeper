<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button,
  apiJson,
  apiErrorMessage,
  setStoredDeviceToken,
  useCameraScanner,
  usePluginsStore,
  useSessionStore,
  writeStoredLocale,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { KeyRound, ScanLine, X } from '@lucide/vue';
import {
  DEVICE_PAIRING_CODE_PARAM,
  MOBILE_LOGIN_PATH,
  MOBILE_ROOT_PATH,
  parsePairingHandoff,
  type DevicePairingResult,
} from '@makekeeper/plugin-contract';
import MobileInstallOffer from './MobileInstallOffer.vue';

// Where the pairing QR lands (#199). The one-time code in the query IS the
// credential here — the phone has nothing else yet — so this route is public and
// trades the code for a device token that survives restarts and TTLs.
//
// It is also where a phone comes BACK to (#207). An installed app may open with
// no device token at all — iOS keeps a standalone app's storage apart from the
// Safari tab it was installed from — and then there is no code in the URL,
// because nobody navigated here from a QR. So this screen carries its own
// camera: the same QR, scanned from inside the app, is the shortest way back in.
// The password wall is offered as the fallback, not the default, because the
// phone is the device least suited to typing one.

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const session = useSessionStore();

const code = ref('');
const name = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const scanning = ref(false);

const {
  videoRef,
  failed: cameraFailed,
  start: startCamera,
  stop: stopCamera,
} = useCameraScanner((value) => {
  adoptScanned(value);
});

onMounted(() => {
  const fromQuery = route.query[DEVICE_PAIRING_CODE_PARAM];
  code.value = typeof fromQuery === 'string' ? fromQuery : '';
  name.value = t('mobile.pair.defaultName');
});

const openScanner = async (): Promise<void> => {
  error.value = null;
  scanning.value = true;
  await startCamera();
};

const closeScanner = (): void => {
  stopCamera();
  scanning.value = false;
};

// A live camera decodes the same code over and over while it stays in frame, so
// the first read closes the camera and everything after it is ignored. A code
// that is not ours leaves the camera running: the shelf label that happened to
// be in view must not end the scan the person is in the middle of.
const adoptScanned = (value: string): void => {
  if (!scanning.value) return;
  const scanned = parsePairingHandoff(value);
  if (scanned === null) return;
  closeScanner();
  // The language too, not just the code (#211). Opening the QR with the phone's
  // camera app applies it at bootstrap, from the URL; scanning it from in here
  // never navigates, so nothing would. This is the ONLY way back in for an
  // installed app on iOS, whose storage starts out empty — without it that app
  // can never be anything but the phone's OS language.
  if (scanned.locale) {
    locale.value = scanned.locale;
    writeStoredLocale(scanned.locale);
  }
  code.value = scanned.code;
  void pair();
};

const pair = async (): Promise<void> => {
  busy.value = true;
  error.value = null;
  try {
    const result = await apiJson<DevicePairingResult>('/api/devices/redeem', {
      method: 'POST',
      body: { code: code.value, name: name.value.trim() },
      // No credential yet — that is the point.
      public: true,
    });
    // Its own slot, not the session's: a revoked device must not keep
    // presenting a dead credential on surfaces that need none (#199).
    setStoredDeviceToken(result.token);
    // Re-resolve who we are now that we have a credential: without this the
    // shell still believes it is anonymous and its tab bar stays empty, because
    // the plugin set it renders from was fetched without a token.
    await session.bootstrap();
    await usePluginsStore().fetchPlugins();
    await router.replace(MOBILE_ROOT_PATH);
  } catch (err) {
    // Back to square one: a code that was refused is spent, and re-submitting it
    // only produces the same refusal.
    code.value = '';
    error.value = apiErrorMessage(err, t('mobile.pair.failed'));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- Titled by the shell's header, like every screen here. -->

    <!-- No code in the URL: the phone got here on its own, so it scans. -->
    <div v-if="code === ''" class="space-y-3">
      <div v-if="scanning" class="space-y-3">
        <div
          class="relative overflow-hidden rounded-2xl bg-slate-900 aspect-[3/4]"
        >
          <video
            ref="videoRef"
            class="w-full h-full object-cover"
            :aria-label="$t('mobile.pair.cameraPreview')"
            playsinline
            muted
          ></video>
          <div
            class="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/70"
          ></div>
        </div>
        <p v-if="cameraFailed" class="text-sm text-red-600 dark:text-red-400">
          {{ $t('mobile.pair.cameraFailed') }}
        </p>
        <Button variant="secondary" block :icon-left="X" @click="closeScanner">
          {{ $t('mobile.pair.cancelScan') }}
        </Button>
      </div>

      <div v-else class="space-y-3">
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('mobile.pair.scanHint') }}
        </p>
        <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
          {{ error }}
        </p>
        <Button
          variant="primary"
          block
          :icon-left="ScanLine"
          @click="openScanner"
        >
          {{ $t('mobile.pair.scanAction') }}
        </Button>
        <!-- A control that NAVIGATES is a link, but it is styled by the button
             primitive rather than by hand (§5.3): `to` gives both. -->
        <Button
          v-if="session.multiuserEnabled"
          variant="ghost"
          block
          :icon-left="KeyRound"
          :to="MOBILE_LOGIN_PATH"
        >
          {{ $t('mobile.pair.passwordInstead') }}
        </Button>
      </div>
    </div>

    <form v-else class="space-y-4" @submit.prevent="pair">
      <div class="space-y-1">
        <label
          for="mobile-pair-name"
          class="block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          {{ $t('mobile.pair.nameLabel') }}
        </label>
        <input
          id="mobile-pair-name"
          v-model="name"
          type="text"
          maxlength="64"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
        />
      </div>

      <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
        {{ error }}
      </p>

      <Button type="submit" variant="primary" block :loading="busy">
        {{ $t('mobile.pair.action') }}
      </Button>
    </form>

    <!-- Installing belongs to this screen rather than to the home one (#210):
         this is what a phone opens on before it has anything, and an installed
         app pairs as itself anyway. It hangs off the SCREEN, not off the scan
         branch — a phone that arrived from the QR carries a code in the URL and
         sees the naming form instead, which is the most common way to get here.
         Hidden only while the camera owns the screen. -->
    <MobileInstallOffer v-if="!scanning" />
  </div>
</template>
