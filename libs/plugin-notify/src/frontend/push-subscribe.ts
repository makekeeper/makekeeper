import { apiJson } from '@makekeeper/frontend-core';

// Turning a person's "yes" into a push subscription (#311).
//
// Kept out of the component because every step of it can fail in a way that is
// not an error: permission denied, no service worker, a browser that does not
// do push at all (an iPhone outside an installed app). The view needs to say
// which, not show a stack trace.
export type PushOutcome =
  | { status: 'subscribed' }
  | { status: 'unsupported' }
  // Reached over plain http from another machine. Push (like every powerful
  // API) exists only in a secure context, so the browser is not refusing — it
  // has nothing to refuse WITH, and "unsupported" would send somebody hunting
  // for a browser setting that does not exist.
  | { status: 'insecure' }
  | { status: 'denied' }
  | { status: 'failed' };

// The VAPID key travels as base64url and has to reach `subscribe` as bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  );
  const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function keyOf(
  subscription: PushSubscription,
  name: 'p256dh' | 'auth',
): string {
  const key = subscription.getKey(name);
  if (!key) return '';
  return btoa(String.fromCharCode(...new Uint8Array(key)));
}

// The script and scope this app's push registration uses.
//
// `navigator.serviceWorker.ready` is the obvious call and the wrong one here:
// it resolves only for a worker CONTROLLING the current page, and the app's
// only worker is scoped to `/m` — the installed phone shell (#210, which that
// scope exists to protect). On a desktop page `ready` therefore never settles
// and the button would simply hang.
//
// So push gets a registration of its own, scoped to the landing path a
// notification's link points at. A push subscription belongs to a REGISTRATION,
// not to the pages it controls, so this delivers banners everywhere while
// leaving the desktop app free of a worker intercepting its navigations.
const PUSH_SW_SCRIPT = '/sw.js';
const PUSH_SW_SCOPE = '/r/';

// How long to wait for a freshly registered worker to become active before
// giving up. Activation is normally instant (the worker calls `skipWaiting`);
// this is only so a browser that never gets there leaves a button that says so
// instead of one that spins forever.
const ACTIVATION_TIMEOUT_MS = 10_000;

async function pushRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
  // A registration whose scope is exactly ours is reused; the phone shell's
  // `/m` one is deliberately left alone.
  const registration = existing?.scope.endsWith(PUSH_SW_SCOPE)
    ? existing
    : await navigator.serviceWorker.register(PUSH_SW_SCRIPT, {
        scope: PUSH_SW_SCOPE,
      });
  return waitForActive(registration);
}

// `register()` resolves as soon as the registration EXISTS — its worker may
// still be installing, and subscribing to push then throws "no active Service
// Worker". This was the whole of why the button appeared to do nothing: the key
// was fetched, the permission granted, and the very next call failed.
//
// `navigator.serviceWorker.ready` is not the answer either: it waits for a
// worker controlling THIS page, and ours deliberately controls only `/r/`.
async function waitForActive(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return registration;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ACTIVATION_TIMEOUT_MS);
    function finish(): void {
      clearTimeout(timer);
      worker?.removeEventListener('statechange', onStateChange);
      resolve();
    }
    function onStateChange(): void {
      if (worker?.state === 'activated' || worker?.state === 'redundant') {
        finish();
      }
    }
    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  });
  return registration;
}

// Which of the listed devices is the one in front of the reader.
//
// Deliberately looks the registration up instead of creating one: asking who
// you are must not subscribe you. Returns null whenever the answer is unknown
// (no worker, no subscription, no crypto on an insecure origin) — the list then
// simply marks nothing, which is the honest outcome.
export async function currentPushFingerprint(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const registration =
    await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(subscription.endpoint),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export async function enablePush(label: string): Promise<PushOutcome> {
  // Ordered so the answer names the real obstacle: an insecure origin removes
  // the APIs entirely, and reporting that as "your browser cannot" would be a
  // lie about the browser.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { status: 'insecure' };
  }
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof PushManager === 'undefined' ||
    typeof Notification === 'undefined'
  ) {
    return { status: 'unsupported' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'denied' };
  try {
    const { publicKey } = await apiJson<{ publicKey: string }>(
      '/api/notifications/push/key',
    );
    const registration = await pushRegistration();
    const subscription = await registration.pushManager.subscribe({
      // Every browser requires this to be true, and a push nobody sees would
      // not be a notification anyway.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await apiJson('/api/notifications/push/subscriptions', {
      method: 'POST',
      // An OBJECT, not a JSON string: `apiFetch` sets the JSON content type
      // only for the object form, and a hand-stringified body therefore
      // arrived with no content type at all — which the server read as an
      // empty body, failed validation on, and rejected. That one line was why
      // every save on this screen errored.
      body: {
        endpoint: subscription.endpoint,
        p256dh: keyOf(subscription, 'p256dh'),
        auth: keyOf(subscription, 'auth'),
        label,
      },
    });
    return { status: 'subscribed' };
  } catch {
    return { status: 'failed' };
  }
}

// A name a person can tell two devices apart by. The user agent is the only
// thing on offer, so it is trimmed to the part that identifies the machine
// rather than stored whole.
export function deviceLabel(userAgent: string): string {
  const match = /\(([^)]+)\)/.exec(userAgent);
  return (match?.[1] ?? userAgent).slice(0, 60);
}
