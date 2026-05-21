// Vitest config for @tripbng/web.
//
// Test environment: jsdom — RTL needs a DOM to mount React trees into.
// The frontend was vitest-installed-but-unused until Phase E; this config
// lights the harness up so component tests can run.
//
// Path resolution mirrors tsconfig.json's `@/*` alias and the workspace
// shared package's source-tree import so we don't depend on a built
// artifact during test runs.

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
    ],
    testTimeout: 10_000,
    // RTL tests are CPU-bound and isolated — parallel threads are safe
    // and faster than the API's forced single-fork pool.
  },
  // Automatic JSX runtime — same as Next.js. Without this, every test
  // file would need `import React from 'react'` even though the production
  // app doesn't (Next's swc handles it).
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@tripbng/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
