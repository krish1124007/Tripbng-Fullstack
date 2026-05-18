import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { corsOrigins, isProd } from './config/env.js';
import { logger } from './config/logger.js';
import { requestId } from './middleware/requestId.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { errorHandler, notFound } from './middleware/error.js';
import { idempotencyKey } from './middleware/idempotency.js';
import { sentryErrorHandler } from './config/sentry.js';
import { healthRouter } from './routes/health.routes.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(metricsMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(
    helmet({
      // Production CSP — locks scripts to self + Razorpay checkout. Dev mode keeps it
      // permissive so Next dev tooling can hot-reload without yelling.
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'", 'https://api.razorpay.com'],
              frameSrc: ["'self'", 'https://api.razorpay.com'],
              objectSrc: ["'none'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
      hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS: origin not allowed'));
      },
      credentials: true,
    }),
  );
  app.use(compression());
  // 5 MB JSON ceiling — high enough for the admin banner form to POST an
  // inline image as a data: URL (base64 inflates ~33%, so a 2 MB raw image
  // arrives as ~2.7 MB on the wire). Avoids needing a separate multipart
  // upload pipeline + object storage + orphan cleanup. Non-banner endpoints
  // continue to send small bodies; the limit is a ceiling, not a floor.
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Global rate limit (login has its own stricter limiter inside auth routes)
  app.use(generalLimiter);

  // Health endpoints — bypass /api versioning, used by load balancers
  app.use(healthRouter);

  // Idempotency-Key honouring on every mutating route below /api/v1.
  // Advisory mode: missing header is allowed (clients without the key still
  // work). Production should switch enforce:true once all clients are updated.
  app.use('/api/v1', idempotencyKey({ enforce: false }));

  app.use('/api/v1', apiRouter);

  // Sentry error capture before the local errorHandler so we get the raw
  // error in our tracking system AND a sane response to the client.
  app.use(sentryErrorHandler());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
