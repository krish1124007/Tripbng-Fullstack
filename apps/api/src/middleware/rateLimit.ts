import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { isTest } from '../config/env.js';

const makeStore = (prefix: string) =>
  new RedisStore({
    // ioredis typings are too narrow for the variadic call() that rate-limit-redis expects.
    sendCommand: (...args: string[]) =>
      (redis.call as (...a: unknown[]) => Promise<unknown>).apply(redis, args) as Promise<never>,
    prefix: `rl:${prefix}:`,
  });

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? 1000 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: isTest ? undefined : makeStore('gen'),
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' },
    }),
});

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: isTest ? undefined : makeStore('login'),
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many login attempts, please try again later' },
    }),
});
