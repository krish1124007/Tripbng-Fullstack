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
      // Set at vitest.config level so the env module picks it up before any
      // test imports. /internal/* auth middleware reads this.
      INTERNAL_API_KEY: 'test-internal-key-min-32-chars-xxxxx',
      // Tests cancel bookings ~0ms after ticketing and assert the fare-rule
      // cancellation fee was applied. With the production default of 4h, every
      // such cancel falls inside the free-void window and the fee is skipped.
      // Disable the void window in tests so fee behaviour is deterministic;
      // tests targeting the void-window behaviour itself can override per-test.
      TRIPBNG_FLIGHT_VOID_WINDOW_HOURS: '0',
    },
  },
  resolve: {
    alias: {
      '@tripbng/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
