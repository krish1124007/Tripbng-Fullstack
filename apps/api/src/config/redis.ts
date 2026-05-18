import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// Primary connection — used for rate-limit middleware, search cache, ad-hoc Redis ops.
// `maxRetriesPerRequest: 3` keeps non-blocking commands resilient to transient blips.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
});

// BullMQ workers issue blocking commands (BLPOP, BRPOPLPUSH) and refuse a connection that
// has retry behaviour. Dedicated connection so we don't have to weaken the safety on the
// primary connection above.
export const bullmqRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: true,
});

redis.on('connect', () => logger.info('redis connected'));
redis.on('error', (err) => logger.error({ err }, 'redis error'));
bullmqRedis.on('error', (err) => logger.error({ err }, 'bullmq redis error'));

export async function connectRedis(): Promise<void> {
  // ioredis with lazyConnect=true throws if connect() is called twice. The rate-limit-redis
  // store may have already triggered a connection via call(). Guard against the duplicate.
  if (redis.status !== 'ready' && redis.status !== 'connecting' && redis.status !== 'connect') {
    await redis.connect();
  }
  if (
    bullmqRedis.status !== 'ready' &&
    bullmqRedis.status !== 'connecting' &&
    bullmqRedis.status !== 'connect'
  ) {
    await bullmqRedis.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), bullmqRedis.quit()]);
}
