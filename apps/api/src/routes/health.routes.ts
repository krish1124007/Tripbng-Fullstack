import { Router, type Router as RouterT } from 'express';
import mongoose from 'mongoose';
import { redis } from '../config/redis.js';
import { ok } from '../utils/response.js';
import { isLive, isReady } from '../middleware/health.js';
import { registry } from '../config/metrics.js';

export const healthRouter: RouterT = Router();

// /health — backwards-compatible shorthand. Returns 200 as soon as the process is up.
healthRouter.get('/health', (_req, res) => ok(res, { status: 'ok' }));

// /healthz (k8s liveness) — fail only on uncaught crash. Container restarts on 503.
healthRouter.get('/healthz', (_req, res) => {
  if (!isLive()) return res.status(503).send('not live');
  return res.status(200).send('ok');
});

// /readyz (k8s readiness) — fail when deps not connected or during graceful shutdown.
// Failed probes pull the pod out of the LB rotation but don't restart it.
healthRouter.get('/readyz', (_req, res) => {
  if (!isReady()) return res.status(503).send('not ready');
  if (mongoose.connection.readyState !== 1) return res.status(503).send('mongo not ready');
  if (redis.status !== 'ready') return res.status(503).send('redis not ready');
  return res.status(200).send('ready');
});

healthRouter.get('/health/deep', async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.mongo = { ok: mongoose.connection.readyState === 1 };

  try {
    await redis.ping();
    checks.redis = { ok: true };
  } catch (err) {
    checks.redis = { ok: false, detail: (err as Error).message };
  }

  const healthy = Object.values(checks).every((c) => c.ok);
  return res.status(healthy ? 200 : 503).json({ success: healthy, data: { checks } });
});

// /metrics — Prometheus scrape endpoint. Plain text exposition format, no auth — bind to a
// private network interface or front with mTLS in prod (per spec §10.2). Cheap to scrape.
healthRouter.get('/metrics', async (_req, res, next) => {
  try {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  } catch (err) {
    next(err);
  }
});
