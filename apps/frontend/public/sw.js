// Service worker for the mobile surface (#198). Registered from the app with
// `scope: '/m'`, so it never touches the desktop app even though it is served
// from the root — and so it controls `/m` ITSELF, which is the app's
// `start_url`, the precached shell below and the page Chromium decides
// installability on (#210).
//
// UPDATE STRATEGY — the deliberate part. A cache-first worker is how a PWA ends
// up pinned to a build from three weeks ago, which would quietly contradict the
// in-app update checks (#94/#114): the admin sees a new version, the phone keeps
// running the old one. So:
//
//   * navigations are NETWORK-FIRST — online, the phone always gets the current
//     index.html, and the cache is only a fallback for being offline;
//   * hashed build assets are CACHE-FIRST — their URL changes when their content
//     does, so a hit is never stale;
//   * anything else (the API above all) is never cached here.
//
// The worker also activates immediately rather than waiting for every tab to
// close, so an update lands on the next launch instead of "sometime".

const CACHE = 'makekeeper-mobile-v1';
const APP_SHELL = '/m';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(APP_SHELL))
      // A failed precache must not block activation: the surface still works
      // online, and the next navigation refills the cache.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Build output is content-hashed by Vite, so these URLs are safe to serve from
// cache indefinitely — a changed file has a different name.
function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API is live data and auth-bearing; caching it here would serve one
  // device's answers to another user's session after a re-pair.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(APP_SHELL, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(APP_SHELL)
            .then((cached) => cached ?? Response.error()),
        ),
    );
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// Push (#311). The worker is already here for the installed phone app, so the
// notification channel that needs no third party rides along with it.
//
// Deliberately tolerant about the payload: a push that arrives without one (a
// service waking the worker, or an older sender) still shows something rather
// than nothing, because a silent push is worse than a vague one.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'MakeKeeper';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      // One banner per notification, however many devices or repeats: the tag
      // replaces rather than stacks.
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

// Tapping the banner. An app window that is already open is focused and
// navigated rather than duplicated — a second copy of the app is never what
// somebody tapping a notification wanted.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
