import { ref, type Ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';
import type { MobileOriginInfo } from '@makekeeper/plugin-contract';

// Installation of the mobile surface (#198, reworked in #210). Two independent
// facts shape the offer:
//
// 1. The BROWSER's opinion, delivered once as `beforeinstallprompt`. Only
//    Chromium fires it; elsewhere — iOS Safari above all — there is no prompt to
//    show and the offer can only be an instruction.
// 2. The SERVER's verdict about the origin. A quick tunnel produces a
//    home-screen icon that is dead as soon as the tunnel restarts — which is
//    said next to the button rather than used to hide it. Only `insecure` really
//    forecloses an install, and there the browser forecloses it first.

// The event Chromium fires when the page qualifies for installation. Not in
// lib.dom yet, so the two members we use are declared here rather than cast.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isBeforeInstallPromptEvent = (
  event: Event,
): event is BeforeInstallPromptEvent =>
  'prompt' in event &&
  typeof Reflect.get(event, 'prompt') === 'function' &&
  'userChoice' in event;

// Captured at module scope: the event fires once, early, and often before the
// shell component that offers the button has mounted.
const deferredPrompt: Ref<BeforeInstallPromptEvent | null> = ref(null);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar so the offer appears where the
    // rest of the app's affordances are, not over them.
    event.preventDefault();
    if (isBeforeInstallPromptEvent(event)) deferredPrompt.value = event;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt.value = null;
  });
}

export const installPromptAvailable = deferredPrompt;

// Show the browser's install dialog. Resolves once the user answered; the event
// is single-use, so it is dropped either way.
export async function promptInstall(): Promise<'accepted' | 'dismissed'> {
  const event = deferredPrompt.value;
  if (!event) return 'dismissed';
  deferredPrompt.value = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

// Already running as an installed app — nothing to offer.
export function isStandalone(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}

// Memoized: the verdict is a property of the address this tab was opened at, so
// it cannot change while the tab lives, and both the shell (which decides
// whether to register a worker) and the home screen (which decides whether to
// offer installation) ask for it.
let originInfo: Promise<MobileOriginInfo> | null = null;

export function fetchOriginInfo(): Promise<MobileOriginInfo> {
  originInfo ??= apiJson<MobileOriginInfo>('/api/mobile/origin', {
    public: true,
  });
  return originInfo;
}

// The worker itself lives in `service-worker.ts` — its scope is what decides
// whether the browser considers this surface installable, so it is pinned by a
// spec rather than written inline here.
export { registerMobileServiceWorker } from './service-worker';
