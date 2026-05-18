import type { NextFunction, Request, Response } from 'express';
import { httpRequestDuration, httpRequests, statusClass } from '../config/metrics.js';

// metricsMiddleware — records every response with method/route/status-class. Uses the
// matched Express route pattern (e.g. "/users/:id") so cardinality stays low. Falls back to
// "unknown" before the router has matched.
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ?? req.baseUrl ?? 'unknown';
    const labels = {
      method: req.method,
      route: route.length > 80 ? 'unknown' : route,
      status_class: statusClass(res.statusCode),
    };
    httpRequests.inc(labels);
    const elapsedNs = Number(process.hrtime.bigint() - startedAt);
    httpRequestDuration.observe(labels, elapsedNs / 1e9);
  });
  next();
}
