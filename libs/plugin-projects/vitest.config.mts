/// <reference types='vitest' />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// One runner for the whole library. It used to be jest, scoped to `src/backend`
// — which left the frontend specs in `src/frontend` running nowhere at all (the
// jest config said the frontend app's vitest owned them; that config only ever
// looked inside `apps/frontend`). Mirrors plugin-settings, which already runs
// its Nest specs under vitest.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/plugin-projects',
  plugins: [vue(), nxViteTsPaths()],
  test: {
    name: 'plugin-projects',
    watch: false,
    globals: true,
    environment: 'jsdom',
    // class-validator/class-transformer decorators need the metadata shim that
    // Nest loads at bootstrap; specs run without that entrypoint.
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
  },
}));
