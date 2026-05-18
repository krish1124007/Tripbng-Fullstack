import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Serialize test files so DB-touching suites don't race on the same Mongo collections.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/tripbng_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-test-test-test-test-test-test-test-test-test',
      JWT_REFRESH_SECRET: 'test-refresh-test-refresh-test-refresh-test-refresh',
    },
  },
  resolve: {
    alias: {
      '@tripbng/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
