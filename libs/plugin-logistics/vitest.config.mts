/// <reference types='vitest' />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// One runner for the whole library, as in plugin-projects: jest ran the Nest
// specs in a node environment that cannot mount a Vue SFC, so the view specs
// (#375) had nowhere to run.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/plugin-logistics',
  plugins: [vue(), nxViteTsPaths()],
  test: {
    name: 'plugin-logistics',
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
