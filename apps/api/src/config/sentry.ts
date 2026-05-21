// Sentry instrumentation — backend error tracking.
//
// Activation:
//   • `SENTRY_DSN=https://…` in env enables real upload.
//   • Empty DSN routes every helper to pino at error level — same call
//     sites stay valid, no infrastructure dependency, dev/test runs never
//     leak events to a shared project.
//
// Why we don't init at module-load time:
//   `initSentry()` is called explicitly from src/index.ts AFTER env has
//   been validated + logger has been initialised, so failures during
//   start-up still surface clearly. (Mongoose connect / Redis connect
//   happen later in the same boot path; tagging them with sentry adds
//   real value.)

import { logger } from './logger.js';
import { env } from './env.js';

interface SentryOptions {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; tenantId?: string };
}

const ENABLED = !!env.SENTRY_DSN && env.SENTRY_DSN.startsWith('https://');

// Lazy import — the @sentry/node SDK pulls in OpenTelemetry which is
// chunky. We only load it when Sentry is actually enabled so dev startup
// stays snappy and the test suite doesn't pay the import cost.
type SentryNode = typeof import('@sentry/node');
let sentryModule: SentryNode | null = null;

async function getSentry(): Promise<SentryNode | null> {
  if (!ENABLED) return null;
  if (sentryModule) return sentryModule;
  try {
    sentryModule = await import('@sentry/node');
    return sentryModule;
  } catch (err) {
    // The SDK might be missing in a stripped container. Fall back to
    // pino without crashing the process.
    logger.warn({ err }, 'sentry: @sentry/node not installed, falling back to pino');
    return null;
  }
}

export async function initSentry(): Promise<void> {
  if (!ENABLED) {
    logger.info('sentry: SENTRY_DSN not set, error tracking falls back to pino');
    return;
  }
  const Sentry = await getSentry();
  if (!Sentry) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Drop transactions that traversed health checks — they're high
    // volume + low signal, and the Sentry quota matters in production.
    tracesSampler: (samplingContext) => {
      const name = samplingContext.transactionContext?.name ?? '';
      if (name.includes('/health') || name.includes('/metrics')) return 0;
      return env.SENTRY_TRACES_SAMPLE_RATE;
    },
    // Don't ship payloads of inbound requests by default — most carry
    // PII (passport numbers, email addresses, tokens). Each capture
    // call attaches the fields we WANT visible via the `extra` option.
    sendDefaultPii: false,
  });
  logger.info(
    {
      env: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      release: env.SENTRY_RELEASE ?? '(unset)',
    },
    'sentry: instrumented',
  );
}

export function captureException(err: unknown, opts: SentryOptions = {}): void {
  // Mirror to pino regardless of whether Sentry is enabled — local logs
  // stay the canonical record. Sentry is an additional shipper, not a
  // replacement.
  logger.error(
    {
      err,
      sentryTags: opts.tags,
      sentryExtra: opts.extra,
      sentryUser: opts.user,
    },
    'captured-exception',
  );
  if (!ENABLED) return;
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.withScope((scope) => {
      if (opts.tags) scope.setTags(opts.tags);
      if (opts.extra) scope.setExtras(opts.extra);
      if (opts.user) scope.setUser(opts.user);
      Sentry.captureException(err);
    });
  });
}

export function captureMessage(
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
  opts: SentryOptions = {},
): void {
  const fn = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.info;
  fn.call(
    logger,
    { sentryTags: opts.tags, sentryExtra: opts.extra, sentryUser: opts.user },
    message,
  );
  if (!ENABLED) return;
  // Sentry's SeverityLevel uses "warning" instead of "warn" — map at the
  // boundary so callers keep the shorter pino-style label.
  const sentryLevel: 'info' | 'warning' | 'error' =
    level === 'warn' ? 'warning' : level;
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.withScope((scope) => {
      if (opts.tags) scope.setTags(opts.tags);
      if (opts.extra) scope.setExtras(opts.extra);
      if (opts.user) scope.setUser(opts.user);
      Sentry.captureMessage(message, sentryLevel);
    });
  });
}

/** Express request-handler — placed at the top of the middleware chain
 *  so every subsequent error in the request lifecycle is scoped to a
 *  Sentry transaction. */
export function sentryRequestHandler(): (
  req: unknown,
  res: unknown,
  next: () => void,
) => void {
  // When @sentry/node is enabled we install its Express integration via
  // Sentry.setupExpressErrorHandler later. The request handler itself
  // doesn't need explicit scoping in v10 — the SDK's autoinstrumentation
  // wraps requests automatically.
  return (_req, _res, next) => next();
}

/** Express error-handler — drop into the chain just before the
 *  application's central errorHandler. Captures unhandled errors with
 *  the route + auth context attached. */
export function sentryErrorHandler(): (
  err: unknown,
  req: unknown,
  res: unknown,
  next: (err: unknown) => void,
) => void {
  return (err, req, _res, next) => {
    const r = req as {
      method?: string;
      baseUrl?: string;
      path?: string;
      auth?: { userId?: string; tenantId?: string };
    };
    const status = (err as { http?: number })?.http ?? 500;
    captureException(err, {
      tags: { route: `${r.method ?? '?'} ${r.baseUrl ?? ''}${r.path ?? ''}`, status: String(status) },
      ...(r.auth?.userId || r.auth?.tenantId
        ? {
            user: {
              ...(r.auth.userId ? { id: r.auth.userId } : {}),
              ...(r.auth.tenantId ? { tenantId: r.auth.tenantId } : {}),
            },
          }
        : {}),
    });
    next(err);
  };
}
