// Bus booking routes — the critical-path endpoint that runs the
// block + book + reconcile flow.
//
// Mounted at /api/v1/bus/bookings. Auth + tenant scoping flow from the
// parent busRouter; per-route permissions live here.
//
// Idempotency: callers can supply an `Idempotency-Key` header. Required
// to safely retry from the SPA — without it, a refreshed page or a
// dropped network response leads to a duplicate booking attempt that
// the lock catches with a 409, but at the cost of a wasted SeatSeller
// round-trip.

import { Router, type Router as RouterT } from 'express';
import {
  BusBookingRequestSchema,
  BusCancellationRequestSchema,
  type BusCancellationResult,
  type PublicBusBooking,
  type PublicBusCancellation,
} from '@tripbng/shared';
import { requirePermission } from '../middleware/rbac.js';
import { requireNotFrozen } from '../middleware/cutover-freeze.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { createBusBooking } from '../services/bus/booking.service.js';
import {
  cancelBooking,
  previewCancellation,
} from '../services/bus/cancellation.service.js';
import { BusBooking, type BusBookingDoc } from '../models/BusBooking.js';
import type { BusCancellationDoc } from '../models/BusCancellation.js';
import { AppError } from '@tripbng/shared';

export const busBookingsRouter: RouterT = Router();

// ────────── Create ──────────

busBookingsRouter.post(
  '/',
  requireNotFrozen('booking'),
  requirePermission('bus-booking:create'),
  validate(BusBookingRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof BusBookingRequestSchema.parse>;
      const idempotencyKey =
        typeof req.header('Idempotency-Key') === 'string'
          ? req.header('Idempotency-Key')!.slice(0, 80)
          : undefined;

      // Resolve walletOwnerId from the actor's agency. We don't trust the
      // body for the wallet target — that's how cross-tenant theft would
      // happen. The agency-on-token is authoritative.
      if (!req.auth!.agencyId) {
        throw new AppError('FORBIDDEN', { reason: 'no agency context for booking' });
      }

      const booking = await createBusBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          walletKind: 'AGENCY',
          walletOwnerId: req.auth!.agencyId,
          ipAddress: req.ip ?? null,
        },
        {
          approvalId: body.approvalId,
          gstProfileId: body.gstProfileId ?? null,
          passengers: body.passengers,
          idempotencyKey: idempotencyKey ?? null,
        },
      );
      return ok(res, toPublicBooking(booking));
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Read by id ──────────

busBookingsRouter.get(
  '/:id',
  requirePermission('bus-booking:read'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const doc = await BusBooking.findOne({
        _id: id,
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      });
      if (!doc) throw new AppError('NOT_FOUND', { reason: 'bus booking not found' });
      return ok(res, toPublicBooking(doc));
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Read agency-scoped list ──────────

busBookingsRouter.get(
  '/',
  requirePermission('bus-booking:read'),
  async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20),
      );

      const q: Record<string, unknown> = {
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      };
      if (status) q.status = status;

      const [items, total] = await Promise.all([
        BusBooking.find(q)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        BusBooking.countDocuments(q),
      ]);

      return ok(res, {
        items: items.map(toPublicBooking),
        total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Cancellation preview ──────────

/**
 * GET /api/v1/bus/bookings/:id/cancellation-preview
 *
 * LIVE preview from SeatSeller — never cached. The agent reviews
 * before confirming via POST /:id/cancel.
 */
busBookingsRouter.get(
  '/:id/cancellation-preview',
  requirePermission('bus-booking:cancel'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const preview = await previewCancellation(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId!,
          ipAddress: req.ip ?? null,
        },
        id!,
      );
      // Strip the raw SeatSeller envelope from the public response —
      // it's debug-only.
      const { raw, ...publicPreview } = preview;
      void raw;
      return ok(res, publicPreview);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Cancel commit ──────────

/**
 * POST /api/v1/bus/bookings/:id/cancel
 * body: { seats?: string[], note?: string }
 *
 * Full cancel when seats[] is missing/empty; partial when populated.
 * Returns the updated booking + the persisted cancellation row.
 */
busBookingsRouter.post(
  '/:id/cancel',
  requireNotFrozen('booking'),
  requirePermission('bus-booking:cancel'),
  validate(BusCancellationRequestSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const body = req.body as ReturnType<typeof BusCancellationRequestSchema.parse>;
      const result = await cancelBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId!,
          ipAddress: req.ip ?? null,
        },
        id!,
        { seatsToCancel: body.seats, note: body.note },
      );
      const response: BusCancellationResult = {
        booking: toPublicBooking(result.booking),
        cancellation: toPublicCancellation(result.cancellation),
        refundPaise: result.refundPaise,
        chargePaise: result.chargePaise,
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Mapper ──────────

function toPublicBooking(d: BusBookingDoc): PublicBusBooking {
  return {
    id: String(d._id),
    bookingRef: d.bookingRef,
    status: d.status,
    approvalId: String(d.approvalId),
    employeeId: String(d.employeeId),
    agencyId: String(d.agencyId),
    gstProfileId: d.gstProfileId ? String(d.gstProfileId) : null,
    blockKey: d.blockKey,
    tin: d.tin ?? null,
    pnr: d.pnr ?? null,
    trip: {
      operatorName: d.trip.operatorName ?? '',
      busType: d.trip.busType ?? '',
      sourceCityId: d.trip.sourceCityId,
      sourceCityName: d.trip.sourceCityName ?? '',
      destinationCityId: d.trip.destinationCityId,
      destinationCityName: d.trip.destinationCityName ?? '',
      doj: d.trip.doj,
      departureAt: d.trip.departureAt,
      arrivalAt: d.trip.arrivalAt,
      nextDay: d.trip.nextDay ?? false,
      boardingPoint: {
        id: d.trip.boardingPoint.id,
        name: d.trip.boardingPoint.name,
        address: d.trip.boardingPoint.address,
        landmark: d.trip.boardingPoint.landmark,
        contact: d.trip.boardingPoint.contact,
        timeAt: d.trip.boardingPoint.timeAt,
        timeMinutes: d.trip.boardingPoint.timeMinutes,
      },
      droppingPoint: {
        id: d.trip.droppingPoint.id,
        name: d.trip.droppingPoint.name,
        address: d.trip.droppingPoint.address,
        landmark: d.trip.droppingPoint.landmark,
        contact: d.trip.droppingPoint.contact,
        timeAt: d.trip.droppingPoint.timeAt,
        timeMinutes: d.trip.droppingPoint.timeMinutes,
      },
    },
    passengers: d.passengers.map((p) => ({
      seatName: p.seatName,
      title: p.title,
      name: p.name,
      age: p.age,
      gender: p.gender,
      primary: p.primary,
      ladiesSeat: p.ladiesSeat,
      farePaise: p.farePaise,
      ticketNumber: p.ticketNumber ?? null,
    })),
    fareBreakup: {
      baseFarePaise: d.fareBreakup.baseFarePaise ?? 0,
      operatorServiceChargePaise: d.fareBreakup.operatorServiceChargePaise ?? 0,
      serviceTaxPaise: d.fareBreakup.serviceTaxPaise ?? 0,
      bookingFeePaise: d.fareBreakup.bookingFeePaise ?? 0,
      totalPaise: d.fareBreakup.totalPaise,
    },
    cancellationPolicyString: d.cancellationPolicyString,
    partialCancellationAllowed: d.partialCancellationAllowed,
    failureReason: d.failureReason ?? null,
    blockedAt: d.blockedAt ? d.blockedAt.toISOString() : null,
    bookedAt: d.bookedAt ? d.bookedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toPublicCancellation(c: BusCancellationDoc): PublicBusCancellation {
  return {
    id: String(c._id),
    bookingId: String(c.bookingId),
    seatsCancelled: c.seatsCancelled,
    cancellationChargePaise: c.cancellationChargePaise ?? 0,
    refundAmountPaise: c.refundAmountPaise ?? 0,
    reason: c.reason,
    status: c.status,
    cancellationReference: c.cancellationReference ?? null,
    note: c.note ?? '',
    refundTxnId: c.refundTxnId ? String(c.refundTxnId) : null,
    confirmedAt: c.confirmedAt ? c.confirmedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
