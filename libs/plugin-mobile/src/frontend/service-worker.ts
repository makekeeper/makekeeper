// Registering the service worker that backs the installed phone app (#198).
//
// Its own module, with the browser reached through a port rather than the
// `navigator` global (the same shape `viewport-lock.ts` uses), because the SCOPE
// is the part that has to stay right: it decides which pages a worker controls,
// and therefore whether the browser considers the surface installable at all.

// The narrowest slice of `ServiceWorkerContainer` this needs. Registrations are
// described by what we do with them — read the scope, retire the stale one.
export interface ServiceWorkerRegistrationLike {
  readonly scope: string;
  unregister(): Promise<boolean>;
}

export interface ServiceWorkerHost {
  register(
    script: string,
    options: { scope: string },
  ): Promise<ServiceWorkerRegistrationLike>;
  getRegistrations(): Promise<readonly ServiceWorkerRegistrationLike[]>;
}

// The script lives at the root, so its default scope would be the whole site;
// narrowing is always permitted (widening is not) and keeps the desktop app free
// of a worker it never asked for.
//
// `/m`, NOT `/m/` (#210). A trailing slash excludes `/m` ITSELF — which is the
// manifest's `start_url`, the shell's precached page and the URL a phone opens.
// Under `/m/` no worker controlled that navigation, so Chromium never fired
// `beforeinstallprompt` there (it requires a controlling worker with a fetch
// handler): the install offer could not appear however it was gated, and the
// installed app cold-started with nothing cached.
export const MOBILE_SW_SCOPE = '/m';

// What every phone that ran a build before #210 is still carrying.
const LEGACY_SW_SCOPE = '/m/';

export const MOBILE_SW_SCRIPT = '/sw.js';

export async function installServiceWorker(
  host: ServiceWorkerHost,
): Promise<void> {
  try {
    await host.register(MOBILE_SW_SCRIPT, { scope: MOBILE_SW_SCOPE });
    // Retire the old, narrower registration. Scope matching is longest-prefix,
    // so leaving it in place keeps the stale worker in charge of everything
    // BELOW `/m/` while the new one only handles `/m` itself — two workers, two
    // caches, and a phone that updates half of its screens.
    const registrations = await host.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.scope.endsWith(LEGACY_SW_SCOPE))
        .map((registration) => registration.unregister()),
    );
  } catch {
    // A failed registration costs the offline cache, not the app: the surface
    // works online regardless, so this must never surface as an error.
  }
}

// The real thing. Skipped where the browser has no service workers at all —
// including any origin it refuses to treat as secure, where registration would
// fail anyway.
export async function registerMobileServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  await installServiceWorker(navigator.serviceWorker);
}
