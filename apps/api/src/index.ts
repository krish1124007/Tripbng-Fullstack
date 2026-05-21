import { createApp } from './app.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { initSentry } from './config/sentry.js';
import { startWorkers, stopWorkers } from './queues/index.js';
import { setReady } from './middleware/health.js';
import {
  startOverrideCacheRefresh,
  stopOverrideCacheRefresh,
} from './adapters/integration-override-cache.js';
import { primeIntegrationHealthCache } from './services/integration-status.service.js';

async function main() {
  // Initialise Sentry FIRST so any error from the DB / Redis connect
  // is captured. No-op when SENTRY_DSN is unset.
  await initSentry();

  await connectMongo();
  await connectRedis();

  const app = createApp();
  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info({ port: env.API_PORT, host: env.API_HOST, env: env.NODE_ENV }, 'api listening');
  });

  // RUN_WORKERS=false in env disables in-process workers (use a dedicated worker fleet in
  // larger deployments). Tests never start workers — they create extra Redis traffic and
  // fight with seeded bookings.
  if (!isTest && process.env.RUN_WORKERS !== 'false') {
    await startWorkers();
  }

  // Prime the supplier-override cache so adapter getters honour admin
  // toggles from the very first search request. Subsequent refreshes
  // happen on a 30s interval; admin-side toggles call refresh() directly
  // to take effect immediately on this instance.
  await startOverrideCacheRefresh();

  // Mark readiness only after Mongo, Redis, and (optionally) workers are wired up. Liveness
  // is independent — it stays true as long as the process is alive.
  setReady(true);

  // Background-prime the integration health cache so the admin
  // Suppliers page lands with real status data on first visit. Runs
  // *after* readiness so a slow vendor doesn't push back the readyz
  // probe; failures are logged + ignored.
  void primeIntegrationHealthCache().catch((err) =>
    logger.warn({ err }, 'integration-health prime failed'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    setReady(false);
    server.close(() => logger.info('http server closed'));
    await stopWorkers().catch((err) => logger.error({ err }, 'stopWorkers failed'));
    stopOverrideCacheRefresh();
    await disconnectMongo();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to bootstrap');
  process.exit(1);
});
