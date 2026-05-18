// Admin diagnostics + operational endpoints for individual upstream
// providers.
//
// Mounted under /api/v1/providers. Two auth tiers:
//   - Admin tier (SUPER_ADMIN): debugging/audit routes that bypass the
//     booking-service shaping — used by ops to chase vendor issues.
//   - User tier (authenticated agency users): operational endpoints
//     called by the booking UI between search and hold (pricing, SSR
//     catalog, seat map). Tenant isolation lives implicitly inside the
//     KafilaSearchSession — a user can only touch sessions tied to
//     their own searchId, which the search service scopes per request.
//
// Endpoints (SUPER_ADMIN):
//   GET  /kafila/health           — probe /api/auth/login
//   GET  /kafila/booking/:bookingId — retriveBooking by ID (raw response)
//   GET  /kafila/audit            — paginated KafilaApiLog list w/ filters
//   GET  /kafila/audit/:id        — single audit row detail
//
// Endpoints (authenticated user):
//   POST /kafila/pricing          — body: { supplierFareToken } → AirPricing
//   POST /kafila/ssrs             — body: { supplierFareToken } → GetSSRs
//   POST /kafila/seatmap          — body: { supplierFareToken } → GetSeatMap

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ok } from '../utils/response.js';
import { validate } from '../utils/validate.js';
import { getKafilaAdapterIfConfigured } from '../adapters/registry.js';
import { KafilaApiLog } from '../models/KafilaApiLog.js';

export const providersRouter: RouterT = Router();

// Auth gate: every route needs authentication. The SUPER_ADMIN-only
// routes layer requireRole on top (per-route, not router-wide).
providersRouter.use(authenticate, requireAuth);

const adminOnly = requireRole('SUPER_ADMIN');

// ────────── Health ──────────

providersRouter.get('/kafila/health', adminOnly, async (_req, res, next) => {
  try {
    const adapter = getKafilaAdapterIfConfigured();
    if (!adapter) {
      // 200 + ok:false is intentional — "configured but unhealthy" vs
      // "not enabled at all" are different states; ops dashboards
      // distinguish via the `enabled` flag.
      return ok(res, {
        enabled: false,
        ok: false,
        message:
          'Kafila adapter not configured (set KAFILA_ENABLED=true and KAFILA_USER_ID / KAFILA_API_KEY / KAFILA_API_SECRET)',
      });
    }
    const status = await adapter.healthCheck();
    return ok(res, {
      enabled: true,
      ok: status.ok,
      latencyMs: status.latencyMs,
      message: status.message,
    });
  } catch (err) {
    next(err);
  }
});

// ────────── Operational helpers (admin/debug) ──────────

const TokenBodySchema = z.object({
  supplierFareToken: z
    .string()
    .min(1)
    .regex(/^kfl:/, 'expected a Kafila fare token (kfl:...)'),
});

function requireKafila() {
  const adapter = getKafilaAdapterIfConfigured();
  if (!adapter) {
    throw new AppError('SUPPLIER_UNAVAILABLE', { message: 'Kafila adapter not configured' });
  }
  return adapter;
}

providersRouter.post(
  '/kafila/pricing',
  validate(TokenBodySchema),
  async (req, res, next) => {
    try {
      const adapter = requireKafila();
      const { supplierFareToken } = req.body as z.infer<typeof TokenBodySchema>;
      const result = await adapter.airPricing(supplierFareToken);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

providersRouter.post(
  '/kafila/ssrs',
  validate(TokenBodySchema),
  async (req, res, next) => {
    try {
      const adapter = requireKafila();
      const { supplierFareToken } = req.body as z.infer<typeof TokenBodySchema>;
      const result = await adapter.getSSRs(supplierFareToken);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

providersRouter.post(
  '/kafila/seatmap',
  validate(TokenBodySchema),
  async (req, res, next) => {
    try {
      const adapter = requireKafila();
      const { supplierFareToken } = req.body as z.infer<typeof TokenBodySchema>;
      const result = await adapter.getSeatMap(supplierFareToken);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

providersRouter.get('/kafila/booking/:bookingId', adminOnly, async (req, res, next) => {
  try {
    const adapter = requireKafila();
    const bookingId = String(req.params.bookingId ?? '');
    if (!bookingId) {
      throw new AppError('VALIDATION_ERROR', { message: 'bookingId required' });
    }
    const result = await adapter.retrieveBooking(bookingId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// ────────── Audit-log viewer ──────────

const AuditListQuerySchema = z.object({
  operation: z.string().optional(),
  correlationId: z.string().optional(),
  bookingId: z.string().optional(),
  recLoc: z.string().optional(),
  status: z.enum(['ok', 'error']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

providersRouter.get(
  '/kafila/audit',
  adminOnly,
  validate(AuditListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof AuditListQuerySchema>;
      const filter: Record<string, unknown> = {};
      if (q.operation) filter.operation = q.operation;
      if (q.correlationId) filter.correlationId = q.correlationId;
      if (q.bookingId && Types.ObjectId.isValid(q.bookingId)) {
        filter.bookingId = new Types.ObjectId(q.bookingId);
      }
      if (q.recLoc) filter.recLoc = q.recLoc;
      if (q.status === 'error') filter.errorCode = { $ne: null };
      if (q.status === 'ok') filter.errorCode = null;

      const skip = (q.page - 1) * q.limit;
      const [rows, total] = await Promise.all([
        KafilaApiLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(q.limit)
          // Strip the heavy fields from the list view — they balloon
          // payloads for a paginated dashboard. /audit/:id returns full.
          .select('-request -response -responseHeaders')
          .lean(),
        KafilaApiLog.countDocuments(filter),
      ]);
      return ok(res, {
        rows,
        page: q.page,
        limit: q.limit,
        total,
        pages: Math.ceil(total / q.limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

providersRouter.get('/kafila/audit/:id', adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError('VALIDATION_ERROR', { message: 'invalid audit log id' });
    }
    const row = await KafilaApiLog.findById(id).lean();
    if (!row) throw new AppError('NOT_FOUND', { message: 'audit log not found' });
    return ok(res, row);
  } catch (err) {
    next(err);
  }
});
