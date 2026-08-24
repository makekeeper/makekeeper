<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  BrandMark,
  mobileScreenChrome,
  resolveActiveTab,
  resolvePluginIcon,
  useMobileNav,
  useOfflineQueue,
  useSessionStore,
} from '@makekeeper/frontend-core';
import {
  MOBILE_ROOT_PATH,
  isInstallableVerdict,
  type MobileRouteMeta,
} from '@makekeeper/plugin-contract';
import { fetchOriginInfo, registerMobileServiceWorker } from './install';
import { lockViewport, unlockViewport } from './viewport-lock';
import { requestPortraitLock } from './orientation';
import MobileQueueStatus from './MobileQueueStatus.vue';
import MobileOrientationNotice from './MobileOrientationNotice.vue';
import MobileScreenHeader from './MobileScreenHeader.vue';

// The mobile shell (#198): a phone-sized surface with a bottom tab bar built
// from the plugin registry, exactly the way the sidebar is. It is a DEVICE
// shape, not an interface mode — it deliberately does not participate in the
// simple/advanced UX lens, and it is only ever entered explicitly (no redirect
// by viewport width), so deep links keep opening the full app on a phone.
//
// The shell is exactly ONE viewport tall rather than `min-h-screen` — `h-screen`
// as the floor, upgraded to `h-dvh` behind a `supports` query so the dynamic
// unit wins on the phones that have it (plain class order would not decide it:
// Tailwind emits `h-screen` last, so it would always win). That is not cosmetic: a minimum leaves `<main>` without a
// definite height, so a screen inside it cannot size itself to the space left
// over — which is how the intake camera grew to fill the phone and pushed its
// own controls below the fold.

const route = useRoute();
const { t } = useI18n();
const session = useSessionStore();
const pluginTabs = useMobileNav();

// A phone that has not paired yet must not be shown tabs it cannot open: every
// mobile screen but the pairing one needs a credential, so offering them was
// offering a trip to the login wall. The bar comes back the moment the device
// is paired — no reload, because the session store is reactive.
const showsTabs = computed<boolean>(
  () =>
    route.meta.public !== true &&
    (!session.multiuserEnabled || session.isAuthenticated),
);

// The shell's own Home tab always leads, then whatever plugins contribute. Home
// is core: it is where a user with no mobile plugins enabled still lands on
// something.
const tabs = computed(() => [
  { path: MOBILE_ROOT_PATH, titleKey: 'mobile.tabs.home', icon: 'Hammer' },
  ...pluginTabs.value,
]);

// Longest matching path wins, so a plugin's drill-down route keeps its own tab
// lit instead of falling back to Home (`/m` is a prefix of every mobile path).
// Work that was made where the network was not (#202). The queue is loaded and
// drained by the SHELL rather than by the screen that filled it: a person shoots
// a batch and walks out of the dead zone on some other tab.
const queue = useOfflineQueue();
const drain = (): void => {
  void queue.drain();
};

// Cache the app shell wherever an installed app could live at all. A throwaway
// tunnel counts (#210): a worker there pins a name that will vanish, and so does
// everything else the phone stored — the surface says so where it matters.
onMounted(async () => {
  // The shell owns the whole screen for as long as it is mounted: the page
  // behind it neither scrolls nor zooms, and every list scrolls inside it.
  lockViewport();
  // Ask the platform to hold portrait. Usually refused (it needs a standalone
  // or fullscreen context, and iOS has no such API), which is why it is not
  // awaited for anything and why `MobileOrientationNotice` exists.
  void requestPortraitLock();
  await queue.load();
  drain();
  window.addEventListener('online', drain);
  try {
    if (isInstallableVerdict((await fetchOriginInfo()).verdict)) {
      await registerMobileServiceWorker();
    }
  } catch {
    // No verdict, no worker — the surface works online either way.
  }
});

onBeforeUnmount(() => {
  unlockViewport();
  window.removeEventListener('online', drain);
});

// What the current screen declares about its place here. `route.meta` is a
// free-form bag as far as vue-router is concerned, so each field is NARROWED
// rather than asserted (§5.1) — a plugin that declares the wrong shape gets the
// fallback behaviour, not a crash mid-render.
const metaText = (key: keyof MobileRouteMeta): string | null => {
  const value: unknown = route.meta[key];
  return typeof value === 'string' ? value : null;
};

const metaTitle = (key: 'titleKey' | 'subtitleKey'): string | null => {
  const value = metaText(key);
  return value === null ? null : t(value);
};

// A screen may state its own title and exit — for a title that is not a
// constant (a part's name) or a face of a route that is not a route of its own
// (the intake form). It is the more specific statement about what is on screen,
// so it wins; everything else comes off route meta. ONE bar renders both.
const chrome = mobileScreenChrome;

const backPath = computed<string | null>(
  () => chrome.value?.backTo ?? metaText('parent'),
);

// What the arrow is called: the NAME of the section it returns to, read off the
// tab that owns that path. A bare arrow says a way out exists without saying
// where it lands — on the part detail that left the word "Stock" nowhere on
// screen, and on the intake form it made me invent a word ("Camera") for a
// place that already had one.
//
// Derived, never declared: a back target is a tab root, and that tab carries
// its own label already. Asking each plugin to repeat it is asking the two to
// drift, which is exactly how "Camera" happened.
const backLabel = computed<string | null>(() => {
  const path = backPath.value;
  if (path === null) return null;
  const owner = tabs.value.find((tab) => tab.path === path);
  return owner === undefined ? null : t(owner.titleKey);
});

const header = computed(() => {
  const title = chrome.value?.title ?? metaTitle('titleKey');
  const back = backPath.value;
  if (title === null && back === null) return null;
  const label = backLabel.value;
  return {
    title,
    subtitle: chrome.value?.subtitle ?? metaTitle('subtitleKey'),
    back,
    label: label ?? t('mobile.screen.back'),
    // The visible word cannot say it alone: "Stock" reads as a link INTO stock,
    // not as the way back out of here.
    ariaLabel:
      label === null
        ? undefined
        : t('mobile.screen.backTo', { section: label }),
    // A face of a screen POPS the entry it pushed rather than navigating
    // anywhere, so the arrow and the back gesture do exactly the same thing —
    // and the stack never grows a twin of the screen behind it.
    pops: chrome.value?.back !== undefined,
  };
});

// Which tab is lit — the rule itself lives next door, where it can be tested.
const activePath = computed<string | null>(() =>
  resolveActiveTab(
    route.path,
    metaText('tab'),
    tabs.value.map((tab) => tab.path),
  ),
);
</script>

<template>
  <div
    class="h-screen supports-[height:100dvh]:h-dvh flex flex-col bg-slate-50 dark:bg-dark-900 text-slate-900 dark:text-slate-100"
  >
    <!-- The phone's front door signs itself (#260): the pairing and sign-in
         screens are what a device opens on before it holds a credential, and
         they are the only place here the app says WHOSE surface this is. Same
         lockup as the sidebar and the login screen — one component, so the
         three cannot diverge. It goes once the device is paired: past that the
         header's title is the more useful thing at the top of the screen. -->
    <div
      v-if="!showsTabs"
      class="flex items-center justify-center gap-2.5 px-4 pt-4"
    >
      <BrandMark size="sm" />
      <span class="text-base font-bold text-slate-900 dark:text-white">
        {{ $t('common.appName') }}
      </span>
    </div>

    <!-- THE title of whatever screen is on. Above `<main>`, so it does not
         scroll away with the content and so the screen below still gets a
         DEFINITE height to size itself against. The arrow appears only where
         there is somewhere to climb to. -->
    <MobileScreenHeader
      v-if="header"
      :title="header.title"
      :subtitle="header.subtitle"
      :back="header.back"
      :back-label="header.label"
      :back-aria-label="header.ariaLabel"
      :back-pops="header.pops"
      @back="chrome?.back?.()"
    />

    <!-- `min-h-0` is what lets a screen size ITSELF to the space left over
         instead of pushing its controls below the fold: without it a flex child
         refuses to shrink past its content. The intake camera relies on it. -->
    <main class="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-2">
      <RouterView />
    </main>

    <MobileQueueStatus />

    <!-- A phone on its side gets a rotate-back screen instead of a shell whose
         controls have fallen below the fold. Teleports itself out of here. -->
    <MobileOrientationNotice />

    <nav
      v-if="showsTabs"
      :aria-label="$t('mobile.tabs.ariaLabel')"
      class="sticky bottom-0 flex border-t border-slate-200 dark:border-white/5 bg-white/95 dark:bg-dark-800/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        :aria-current="activePath === tab.path ? 'page' : undefined"
        class="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-2.5 text-xxs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-xl"
        :class="
          activePath === tab.path
            ? 'text-brand-600 dark:text-brand-400'
            : 'text-slate-500 dark:text-slate-400'
        "
      >
        <component :is="resolvePluginIcon(tab.icon)" class="w-5 h-5 shrink-0" />
        <!-- The label truncates rather than widening its tab: the bar is built
             from however many plugins are enabled, and a long word in a fifth
             tab used to push the row past the screen instead of shortening
             itself. `min-w-0` on the tab is what lets it. -->
        <span class="max-w-full truncate">{{ $t(tab.titleKey) }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
