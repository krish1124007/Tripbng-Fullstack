// Admin endpoints for TBO operations.
//
// Mounts under /api/v1/admin/tbo. SUPER_ADMIN-only — these endpoints can
// trigger heavy upstream calls (HotelDetails for thousands of codes), so
// keeping the blast radius small is important.
//
// Endpoints:
//   POST /sync/countries       — refresh tbo_countries
//   POST /sync/cities          — refresh tbo_cities for a country (body.countryCode)
//   POST /sync/hotels          — refresh hotel-code list for a city  (body.cityId)
//   POST /sync/hotel-details   — enrich hotel-detail records         (body.hotelCodes[])
//   POST /auth/refresh         — force-refresh the cached token
//   GET  /audit                — paginated list of TBO audit rows w/ filters
//   GET  /audit/export         — JSON download for a booking/traceId (TBO support tickets)
//   GET  /audit/:id            — single audit row detail

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ok } from '../utils/response.js';
import { validate } from '../utils/validate.js';
import { TboAuditLog } from '../models/TboAuditLog.js';
import { HotelBooking } from '../models/HotelBooking.js';
import { tboAuthService } from '../services/tbo/auth.service.js';
import {
  syncCitiesForCountry,
  syncCountries,
  syncHotelDetails,
  syncHotelsForCity,
} from '../services/tbo/reference-sync.service.js';

export const adminTboRouter: RouterT = Router();

// SUPER_ADMIN only — these are heavy operations.
adminTboRouter.use(authenticate, requireAuth, requireRole('SUPER_ADMIN'));

adminTboRouter.post('/sync/countries', async (_req, res, next) => {
  try {
    const result = await syncCountries();
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

const SyncCitiesSchema = z.object({
  countryCode: z.string().min(2).max(3),
});
adminTboRouter.post('/sync/cities', validate(SyncCitiesSchema), async (req, res, next) => {
  try {
    const body = req.body as ReturnType<typeof SyncCitiesSchema.parse>;
    const result = await syncCitiesForCountry(body.countryCode);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

const SyncHotelsSchema = z.object({
  cityId: z.string().min(1),
});
adminTboRouter.post('/sync/hotels', validate(SyncHotelsSchema), async (req, res, next) => {
  try {
    const body = req.body as ReturnType<typeof SyncHotelsSchema.parse>;
    const result = await syncHotelsForCity(body.cityId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

const SyncDetailsSchema = z.object({
  // Cap at 500 codes per call — anything bigger should be split client-side.
  // Server-side fan-out (3 parallel × 50 batch = 6 calls) keeps TBO load sane.
  hotelCodes: z.array(z.string().min(1)).min(1).max(500),
});
adminTboRouter.post('/sync/hotel-details', validate(SyncDetailsSchema), async (req, res, next) => {
  try {
    const body = req.body as ReturnType<typeof SyncDetailsSchema.parse>;
    const result = await syncHotelDetails(body.hotelCodes);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

adminTboRouter.post('/auth/refresh', async (_req, res, next) => {
  try {
    const token = await tboAuthService.forceRefresh();
    if (!token) throw new AppError('VALIDATION_ERROR', { reason: 'force-refresh returned empty' });
    return ok(res, { refreshed: true, tokenLength: token.length });
  } catch (err) {
    next(err);
  }
});

// ───────── Audit log viewer ─────────
//
// TBO certification (CLAUDE.md §13) requires that the request + response
// JSON for any booking be exportable on demand for support tickets. These
// endpoints fulfil that:
//
//   GET /audit             paginated browse with filters
//   GET /audit/export      attachment-style JSON download keyed on
//                          bookingId / bookingCode / traceId
//   GET /audit/:id         single-row detail
//
// All sensitive request/response fields (Password, PAN, passport, etc.)
// were redacted at write time by adapters/tbo/redact.ts — these endpoints
// just surface what's already in tbo_audit_logs.

export const AuditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  bookingId: z.string().optional(),
  bookingCode: z.string().optional(),
  traceId: z.string().optional(),
  /** Filter by TBO method name (Authenticate, Search, PreBook, …). */
  method: z.string().optional(),
  /** ISO yyyy-mm-dd lower bound on createdAt. */
  from: z.coerce.date().optional(),
  /** ISO yyyy-mm-dd upper bound on createdAt. */
  to: z.coerce.date().optional(),
  /** When true, return only rows where the call ended in error
   *  (tboStatus !== 1 OR errorCode is set OR httpStatus >= 400).
   *  Note: stringly-coerced to handle Express query-string values
   *  ("true"/"false") — `z.coerce.boolean()` treats "false" as truthy
   *  so we can't use it. */
  erroredOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((v) => v === true || v === 'true'),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

/**
 * Pure-function filter builder for the audit list endpoint. Extracted so
 * it can be unit-tested without spinning up Mongo. Throws AppError on
 * invalid bookingId so the route can map it to a 400.
 */
export function buildAuditListFilter(q: AuditListQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (q.bookingId) {
    if (!Types.ObjectId.isValid(q.bookingId)) {
      throw new AppError('VALIDATION_ERROR', { reason: 'bookingId is not a valid ObjectId' });
    }
    filter.bookingId = new Types.ObjectId(q.bookingId);
  }
  if (q.bookingCode) filter.bookingCode = q.bookingCode;
  if (q.traceId) filter.traceId = q.traceId;
  if (q.method) filter.method = q.method;
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = q.from;
    if (q.to) range.$lte = q.to;
    filter.createdAt = range;
  }
  if (q.erroredOnly) {
    filter.$or = [
      { tboStatus: { $ne: 1 } },
      { errorCode: { $ne: null } },
      { httpStatus: { $gte: 400 } },
    ];
  }
  return filter;
}

adminTboRouter.get('/audit', validate(AuditListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as ReturnType<typeof AuditListQuerySchema.parse>;
    const filter = buildAuditListFilter(q);

    const [items, total] = await Promise.all([
      TboAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        // Slim list view — full request/response only on /:id detail.
        .select('method host bookingId bookingCode traceId sessionId httpStatus tboStatus errorCode errorMessage durationMs createdAt')
        .lean(),
      TboAuditLog.countDocuments(filter),
    ]);

    return ok(res, items, {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  } catch (err) {
    next(err);
  }
});

const AuditExportQuerySchema = z
  .object({
    bookingId: z.string().optional(),
    bookingCode: z.string().optional(),
    traceId: z.string().optional(),
  })
  .refine((v) => !!(v.bookingId || v.bookingCode || v.traceId), {
    message: 'one of bookingId / bookingCode / traceId is required',
  });

adminTboRouter.get(
  '/audit/export',
  validate(AuditExportQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof AuditExportQuerySchema.parse>;
      const filter: Record<string, unknown> = {};
      let key = '';

      if (q.bookingId) {
        if (!Types.ObjectId.isValid(q.bookingId)) {
          throw new AppError('VALIDATION_ERROR', { reason: 'bookingId is not a valid ObjectId' });
        }
        filter.bookingId = new Types.ObjectId(q.bookingId);
        key = `booking-${q.bookingId}`;
      } else if (q.bookingCode) {
        filter.bookingCode = q.bookingCode;
        key = `bookingcode-${q.bookingCode}`;
      } else if (q.traceId) {
        filter.traceId = q.traceId;
        key = `trace-${q.traceId}`;
      }

      // Cap export at 1000 rows — protects against accidentally huge
      // downloads when someone queries by a traceId that's been re-used or
      // by a long-running booking. Rows beyond the cap still exist in Mongo.
      const rows = await TboAuditLog.find(filter).sort({ createdAt: 1 }).limit(1000).lean();

      const filename = `tbo-audit-${key}-${new Date().toISOString().slice(0, 10)}.json`.replace(
        /[^a-zA-Z0-9.-]/g,
        '_',
      );
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json({
        exportedAt: new Date().toISOString(),
        filter: q,
        rowCount: rows.length,
        truncated: rows.length === 1000,
        rows,
      });
    } catch (err) {
      next(err);
    }
  },
);

adminTboRouter.get('/audit/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const row = await TboAuditLog.findById(req.params.id).lean();
    if (!row) throw new AppError('NOT_FOUND');
    return ok(res, row);
  } catch (err) {
    next(err);
  }
});

// ───────── Ops dashboard ─────────
//
// Operational visibility into bookings that need manual attention. Each
// endpoint surfaces a specific signal so the ops dashboard can route
// to the right escalation path:
//
//   stuck-pending  PENDING_SUPPLIER for >30 min — TBO never resolved.
//                  Action: manual GetBookingDetail + status decision.
//   voucher-due    HELD bookings within 24h of lastCancellationDate.
//                  Action: trigger /bookings/:id/voucher manually if
//                  the auto-voucher worker is misbehaving.
//   refund-stuck   BOOK_FAILED with a wallet debit but no refund txn.
//                  Action: post a manual REFUND_CREDIT via the wallet
//                  ledger; investigate why the auto-refund failed.
//   dashboard      One-shot summary counts for the ops landing page.
//
// Pure-function filter builders are exported so they're unit-testable
// without spinning up Mongo.

const OpsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Override default thresholds — useful for ad-hoc investigation. */
  olderThanMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  withinHours: z.coerce.number().int().min(1).max(168).optional(),
});
export type OpsListQuery = z.infer<typeof OpsListQuerySchema>;

const STUCK_PENDING_DEFAULT_MIN = 30;
const VOUCHER_DUE_DEFAULT_HOURS = 24;

/**
 * Bookings stuck in PENDING_SUPPLIER for longer than the given threshold.
 * `olderThanMinutes` defaults to 30 — anything beyond that is past TBO's
 * normal resolution window for Pending bookings.
 */
export function buildStuckPendingFilter(q: OpsListQuery, now: Date = new Date()): Record<string, unknown> {
  const minutes = q.olderThanMinutes ?? STUCK_PENDING_DEFAULT_MIN;
  const cutoff = new Date(now.getTime() - minutes * 60 * 1000);
  return {
    status: 'PENDING_SUPPLIER',
    bookedAt: { $lt: cutoff },
  };
}

/**
 * Held bookings whose lastCancellationDate is within the next N hours.
 * `withinHours` defaults to 24. The voucher worker SHOULD have fired at
 * (lastCancellationDate − VOUCHER_LEAD_HOURS) — if these bookings are
 * still HELD, something is wrong.
 */
export function buildVoucherDueFilter(q: OpsListQuery, now: Date = new Date()): Record<string, unknown> {
  const hours = q.withinHours ?? VOUCHER_DUE_DEFAULT_HOURS;
  const horizon = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return {
    status: 'HELD',
    lastCancellationDate: { $ne: null, $lte: horizon, $gte: now },
  };
}

/**
 * Bookings where the wallet was debited but the refund never posted.
 * BOOK_FAILED + walletDebitTxnId set + walletRefundTxnId null. Real-money
 * exposure for the agency until ops reconciles.
 */
export function buildRefundStuckFilter(): Record<string, unknown> {
  return {
    status: 'BOOK_FAILED',
    walletDebitTxnId: { $ne: null },
    walletRefundTxnId: null,
  };
}

const OPS_LIST_PROJECTION =
  'bookingCode status hotel checkIn checkOut nights pricing supplierRefs lastCancellationDate bookedAt confirmedAt walletDebitTxnId walletRefundTxnId pendingPoll createdAt agencyId';

adminTboRouter.get(
  '/ops/stuck-pending',
  validate(OpsListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof OpsListQuerySchema.parse>;
      const filter = buildStuckPendingFilter(q);
      const [items, total] = await Promise.all([
        HotelBooking.find(filter)
          .sort({ bookedAt: 1 }) // oldest first — biggest problems
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .select(OPS_LIST_PROJECTION)
          .lean(),
        HotelBooking.countDocuments(filter),
      ]);
      return ok(res, items, {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

adminTboRouter.get(
  '/ops/voucher-due',
  validate(OpsListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof OpsListQuerySchema.parse>;
      const filter = buildVoucherDueFilter(q);
      const [items, total] = await Promise.all([
        HotelBooking.find(filter)
          .sort({ lastCancellationDate: 1 }) // imminent first
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .select(OPS_LIST_PROJECTION)
          .lean(),
        HotelBooking.countDocuments(filter),
      ]);
      return ok(res, items, {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

adminTboRouter.get(
  '/ops/refund-stuck',
  validate(OpsListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof OpsListQuerySchema.parse>;
      const filter = buildRefundStuckFilter();
      const [items, total] = await Promise.all([
        HotelBooking.find(filter)
          .sort({ createdAt: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .select(OPS_LIST_PROJECTION)
          .lean(),
        HotelBooking.countDocuments(filter),
      ]);
      return ok(res, items, {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

adminTboRouter.get('/ops/dashboard', async (_req, res, next) => {
  try {
    const now = new Date();
    const empty = OpsListQuerySchema.parse({});
    const [stuckPending, voucherDue, refundStuck, awaitingApproval] = await Promise.all([
      HotelBooking.countDocuments(buildStuckPendingFilter(empty, now)),
      HotelBooking.countDocuments(buildVoucherDueFilter(empty, now)),
      HotelBooking.countDocuments(buildRefundStuckFilter()),
      HotelBooking.countDocuments({ status: 'AWAITING_APPROVAL' }),
    ]);
    return ok(res, {
      generatedAt: now.toISOString(),
      stuckPending,
      voucherDue,
      refundStuck,
      awaitingApproval,
      thresholds: {
        stuckPendingMinutes: STUCK_PENDING_DEFAULT_MIN,
        voucherDueWithinHours: VOUCHER_DUE_DEFAULT_HOURS,
      },
    });
  } catch (err) {
    next(err);
  }
});
