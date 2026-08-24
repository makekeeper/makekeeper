import {
  MOBILE_SW_SCOPE,
  installServiceWorker,
  type ServiceWorkerHost,
  type ServiceWorkerRegistrationLike,
} from './service-worker';

// The scope is the whole ticket (#210): under `/m/` no worker controlled `/m`
// itself, so Chromium never offered the install and the app cold-started
// uncached. Cheap to get wrong again by "tidying up" a trailing slash, so it is
// pinned here — together with retiring the registration phones already carry.

function fakeRegistration(scope: string): ServiceWorkerRegistrationLike & {
  unregistered: boolean;
} {
  return {
    scope,
    unregistered: false,
    unregister() {
      this.unregistered = true;
      return Promise.resolve(true);
    },
  };
}

function fakeHost(options: {
  existing?: ReturnType<typeof fakeRegistration>[];
  failRegister?: boolean;
}) {
  const existing = options.existing ?? [];
  const calls: { script: string; scope: string }[] = [];

  const host: ServiceWorkerHost = {
    register(script, { scope }) {
      if (options.failRegister) return Promise.reject(new Error('refused'));
      calls.push({ script, scope });
      return Promise.resolve(fakeRegistration(scope));
    },
    getRegistrations() {
      return Promise.resolve(existing);
    },
  };

  return { host, calls, existing };
}

describe('installServiceWorker', () => {
  it('registers at the scope that includes /m itself', async () => {
    const { host, calls } = fakeHost({});
    await installServiceWorker(host);
    expect(calls).toEqual([{ script: '/sw.js', scope: MOBILE_SW_SCOPE }]);
    expect(MOBILE_SW_SCOPE.endsWith('/')).toBe(false);
  });

  it('retires the pre-#210 registration a phone still carries', async () => {
    const legacy = fakeRegistration('https://mk.example.com/m/');
    const current = fakeRegistration('https://mk.example.com/m');
    const { host } = fakeHost({ existing: [legacy, current] });

    await installServiceWorker(host);

    expect(legacy.unregistered).toBe(true);
    // The one just registered must survive — unregistering it would leave the
    // phone with no worker at all.
    expect(current.unregistered).toBe(false);
  });

  it('swallows a refused registration', async () => {
    // No secure context, no worker — and no error either: the surface works
    // online, so this must never reach the user.
    const { host } = fakeHost({ failRegister: true });
    await expect(installServiceWorker(host)).resolves.toBeUndefined();
  });
});
