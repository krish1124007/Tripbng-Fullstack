// Sentry instrumentation — guarded by env. When SENTRY_DSN isn't set, every
// helper is a no-op so dev environments don't push events to a shared project.
//
// We deliberately don't take a runtime dependency on `@sentry/node` (so the
// monorepo install stays slim until Sentry is provisioned). Once provisioned:
//   1. Add `@sentry/node` as a dependency.
//   2. Replace the no-op `captureException` body with `Sentry.captureException(...)`.
//   3. Set SENTRY_DSN in the production secret manager.
//
// Until then the helpers route to pino at error level — same call sites,
// equivalent visibility, no infrastructure dependency.

import { logger } from './logger.js';

interface SentryOptions {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; tenantId?: string };
}

const DSN = process.env.SENTRY_DSN;
const ENABLED = !!DSN && DSN.startsWith('https://');

export function initSentry(): void {
  if (!ENABLED) {
    logger.info('sentry: SENTRY_DSN not set, error tracking falls back to pino');
    return;
  }
  // When @sentry/node is added:
  //   import * as Sentry from '@sentry/node';
  //   Sentry.init({ dsn: DSN, environment: process.env.NODE_ENV, tracesSampleRate: 0.1 });
  logger.info('sentry: instrumented (placeholder — add @sentry/node to enable real upload)');
}

export function captureException(err: unknown, opts: SentryOptions = {}): void {
  // Real implementation:
  //   if (ENABLED) Sentry.withScope((scope) => { scope.setTags(opts.tags); ...; Sentry.captureException(err); });
  logger.error(
    {
      err,
      sentryTags: opts.tags,
      sentryExtra: opts.extra,
      sentryUser: opts.user,
    },
    'captured-exception',
  );
}

export function captureMessage(message: string, level: 'info' | 'warn' | 'error' = 'info', opts: SentryOptions = {}): void {
  const fn = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.info;
  fn.call(
    logger,
    { sentryTags: opts.tags, sentryExtra: opts.extra, sentryUser: opts.user },
    message,
  );
}

/** Express error-middleware adapter — drop into the chain just before `errorHandler`. */
export function sentryRequestHandler() {
  return (_req: unknown, _res: unknown, next: () => void) => next();
}

export function sentryErrorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (err: any, req: any, _res: any, next: any) => {
    captureException(err, {
      tags: { route: `${req.method} ${req.baseUrl}${req.path}`, status: String(err?.http ?? 500) },
      user: { id: req.auth?.userId, tenantId: req.auth?.tenantId },
    });
    next(err);
  };
}
