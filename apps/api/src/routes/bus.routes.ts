// Bus REST routes — Phase 3 surface (search + cities + trip details + BPDP).
//
// Mounted at `/api/v1/bus` from routes/index.ts. All routes require auth
// + the `search:buses` permission. The booking surface (`/api/v1/bus/bookings`)
// lands in Phase 6.
//
// Layered as:
//   GET  /cities                 → autocomplete (cache-first)
//   GET  /search                 → trips list (cache-first per src+dst+doj)
//   GET  /trips/:tripId          → tripDetails (LIVE — never cached)
//   GET  /trips/:tripId/bpdp     → boarding/dropping points (1h cache)
//
// Schema validation comes from packages/shared/src/schemas/bus.ts.

import { Router, type Router as RouterT } from 'express';
import {
  BusCityAutocompleteQuerySchema,
  BusSearchQuerySchema,
  BusTripQuerySchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  getCityAutocomplete,
  searchBuses,
} from '../services/bus/search.service.js';
import {
  getBpDpDetails,
  getTripDetails,
} from '../services/bus/trip.service.js';
import { approvalRouter } from './approval.routes.js';
import { busBookingsRouter } from './bus-bookings.routes.js';
import {
  busInvoiceRouter,
  gstProfileRouter,
} from './gst-profile.routes.js';
import {
  busAuditLogRouter,
  busReportsRouter,
} from './bus-reports.routes.js';

export const busRouter: RouterT = Router();

busRouter.use(authenticate, requireAuth);

// Approval workflow routes — auth/tenant scoping inherited from
// busRouter; permission gates live inside approvalRouter.
busRouter.use('/approvals', approvalRouter);

// Booking routes — block + book + reconcile lives in bus-bookings.routes.
busRouter.use('/bookings', busBookingsRouter);

// Per-booking invoice retrieval (JSON + PDF). Mounted under
// `/bookings/:id/invoice` so the booking-id is param-shared.
busRouter.use('/bookings/:id/invoice', busInvoiceRouter);

// GstProfile admin CRUD.
busRouter.use('/gst-profiles', gstProfileRouter);

// Reports + audit-log viewer (Phase 9).
busRouter.use('/reports', busReportsRouter);
busRouter.use('/audit-log', busAuditLogRouter);

/**
 * GET /api/v1/bus/cities?q=del&limit=12
 *
 * Cache-first city autocomplete. Falls back to a live SeatSeller pull
 * on first hit when the cron-driven cache hasn't warmed yet.
 */
busRouter.get(
  '/cities',
  requirePermission('search:buses'),
  validate(BusCityAutocompleteQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { q, limit } = req.query as unknown as ReturnType<
        typeof BusCityAutocompleteQuerySchema.parse
      >;
      const result = await getCityAutocomplete(q ?? '', limit);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/bus/search?source=122&destination=124&doj=2026-06-15
 *                        [&employeeId=...]
 *
 * Returns trips for the route+date. Cached per (src, dst, doj) with
 * peak-season-aware TTL (30 min peak / 2 h off-peak).
 *
 * When `employeeId` is provided, the service resolves the employee's
 * TravelPolicy and filters out non-compliant trips at the result-set
 * level. Without it, all trips are returned (existing legacy behaviour).
 */
busRouter.get(
  '/search',
  requirePermission('search:buses'),
  validate(BusSearchQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { source, destination, doj } = req.query as unknown as ReturnType<
        typeof BusSearchQuerySchema.parse
      >;
      const employeeId =
        typeof req.query.employeeId === 'string' && req.query.employeeId.length === 24
          ? req.query.employeeId
          : undefined;
      const result = await searchBuses({ source, destination, doj, employeeId });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/bus/trips/:tripId?doj=2026-06-15
 * GET /api/v1/bus/trips/:tripId?doj=2026-06-15&bpId=1001&dpId=2001
 *
 * Live tripDetails — NEVER cached (CLAUDE.md §0 Law 1). Pass bpId+dpId
 * to use the V2 endpoint for operators on the BP-DP model. The doj
 * query param is required so we can resolve SeatSeller's minute offsets
 * to ISO timestamps for the seat-layout UI.
 */
busRouter.get(
  '/trips/:tripId',
  requirePermission('search:buses'),
  validate(BusTripQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const { doj, bpId, dpId } = req.query as unknown as ReturnType<
        typeof BusTripQuerySchema.parse
      >;
      // V2 (BP-DP model) only when both ids are supplied. Missing one is
      // ambiguous — surface as a 400 via the schema's optional union.
      const result =
        bpId !== undefined && dpId !== undefined
          ? await import('../services/bus/trip.service.js').then((m) =>
              m.getTripDetailsV2(tripId!, bpId, dpId, doj),
            )
          : await getTripDetails(tripId!, doj);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/bus/trips/:tripId/bpdp?doj=2026-06-15
 *
 * Boarding + dropping points. Short cache (1h); doj is required to
 * resolve minute offsets to ISO timestamps.
 */
busRouter.get(
  '/trips/:tripId/bpdp',
  requirePermission('search:buses'),
  validate(BusTripQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const { doj, bpId } = req.query as unknown as ReturnType<
        typeof BusTripQuerySchema.parse
      >;
      const result = await getBpDpDetails(tripId!, doj, bpId);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);
