/// <reference types='vitest' />
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tsconfigPaths from 'vite-tsconfig-paths';

// Dev-only guard (#64): the Vite HMR client force-reloads the page the moment
// its websocket reconnects after an outage ("[vite] server connection lost.
// Polling for restart..." → location.reload()). Behind the nginx proxy every
// backend/network drop severs that websocket too, so recovery wiped the user's
// in-progress edits even though the app itself keeps its state. The reload is
// hardcoded in the client (no config flag, and listener exceptions are
// swallowed via Promise.allSettled), so strip the reload call out of the
// served client module: after a reconnect the page must stay exactly as it
// was. Trade-off: if the dev server itself truly restarted, refresh manually.
// A production build ships no Vite client, so this is a serve-only concern.
const noReloadOnWsReconnect = (): Plugin => ({
  name: 'makekeeper:no-reload-on-ws-reconnect',
  apply: 'serve',
  transform(code, id) {
    if (!id.includes('vite/dist/client/client.mjs')) return null;
    return code.replace(
      /await waitForSuccessfulPing\(url\.href\);\s*location\.reload\(\);/,
      'await waitForSuccessfulPing(url.href);',
    );
  },
});

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/frontend',
  server: {
    port: 4200,
    host: true,
    // Phone-capture (issue #6) reaches the SPA over a tunnel whose host is
    // arbitrary and ephemeral (e.g. a random *.trycloudflare.com, or any
    // operator's own domain), so it can't be enumerated here. The dev server
    // otherwise blocks requests whose Host isn't allow-listed (a DNS-rebinding
    // guard); allow any host. This is dev-only — a production static build is
    // served by nginx, which has no such check. See docs/tls-public-access.md.
    allowedHosts: true,
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [
    vue(),
    tsconfigPaths(),
    noReloadOnWsReconnect(),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //   plugins: () => [ nxViteTsPaths() ],
  // },
  build: {
    outDir: '../../dist/apps/frontend',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: 'frontend',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/frontend',
      provider: 'v8' as const,
    },
  },
}));
