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
      // Tests run against a DEDICATED, isolated Mongo + the running Redis.
      //   Mongo: a throwaway standalone on :27019 (spin up with
      //     `docker run -d --name tripbng-test-mongo -p 27019:27017 mongo:6.0`)
      //     — keeps test data away from the dev DB and the uninitiated-replSet
      //     container on :27018.
      //   Redis: the dev instance on :6380, logical DB 1 (isolated from dev's DB 0).
      // The dev Docker uses non-default ports (Mongo 27018, Redis 6380); pointing
      // the old config at :6379/:27017 is why every Redis/Mongo suite failed with
      // ECONNREFUSED. CI overrides via TEST_MONGO_URI / TEST_REDIS_URL.
      MONGO_URI: process.env.TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27019/tripbng_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380/1',
      JWT_ACCESS_SECRET: 'test-test-test-test-test-test-test-test-test-test',
      JWT_REFRESH_SECRET: 'test-refresh-test-refresh-test-refresh-test-refresh',
      // Disable the 4h free-void window in tests so the cancellation-fee path
      // (fare-rule bands) is actually exercised. Production keeps the 4h default.
      TRIPBNG_FLIGHT_VOID_WINDOW_HOURS: '0',
    },
  },
  resolve: {
    alias: {
      '@tripbng/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
