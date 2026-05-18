// TBO-backed hotels API.
//
// Mounted at /api/v1/hotels — supersedes the legacy mock /hotels/search
// inside productsRouter (which stays as a placeholder for environments
// where TBO_ENABLED=false).
//
// Routes:
//   GET   /cities/autocomplete         — local Mongo lookup, no TBO call
//   POST  /search                      — TBO Search fanout, normalized result
//   POST  /prebook                     — TBO PreBook + DRAFT booking persist
//   GET   /draft/:id                   — load DRAFT booking with rules

import { randomUUID } from 'node:crypto';
import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  HotelAvailRequestSchema,
  HotelBookingListQuerySchema,
  HotelOfferSchema,
  HotelPreBookRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { searchAgencyLimit, bookingAgencyLimit } from '../middleware/agency-rate-limit.js';
import { requirePermission } from '../middleware/rbac.js';
import { ok, created } from '../utils/response.js';
import { validate } from '../utils/validate.js';
import { TboCity } from '../models/TboCity.js';
import { HotelBooking } from '../models/HotelBooking.js';
import { HotelCancellationJob } from '../models/HotelCancellationJob.js';
import { searchHotels } from '../services/tbo/search.service.js';
import { preBookHotel } from '../services/tbo/prebook.service.js';
import { bookHotel } from '../services/tbo/book.service.js';
import { voucherHotelBooking } from '../services/tbo/voucher.service.js';
import { fetchBookingDetail } from '../services/tbo/booking-detail.service.js';
import { mapBookingDetailResponse } from '../adapters/tbo/mappers/book.mapper.js';
import { requestCancel } from '../services/tbo/cancel.service.js';
import { TboError } from '../adapters/tbo/errors.js';
import { MockHotelAdapter } from '../adapters/products.mock.js';
import { logger } from '../config/logger.js';

export const hotelsRouter: RouterT = Router();

hotelsRouter.use(authenticate, requireAuth);

// ────────── City autocomplete ──────────

const AutocompleteQuerySchema = z.object({
  q: z.string().min(2).max(60),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  /** Optional country filter, ISO alpha-2. */
  cc: z.string().length(2).optional(),
});

hotelsRouter.get(
  '/cities/autocomplete',
  validate(AutocompleteQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { q, limit, cc } = req.query as unknown as ReturnType<
        typeof AutocompleteQuerySchema.parse
      >;
      // Prefix + substring match. Mongo's text index ranks weak on short
      // queries, so we use a case-insensitive regex anchored at word starts
      // — fast enough for 3K-row reference data.
      const filter: Record<string, unknown> = {
        name: new RegExp(`^${escapeRegex(q)}|\\b${escapeRegex(q)}`, 'i'),
      };
      if (cc) filter.countryCode = cc.toUpperCase();
      const items = await TboCity.find(filter)
        .sort({ hotelCount: -1, name: 1 })
        .limit(limit)
        .select('cityId name countryCode state hotelCount')
        .lean();
      return ok(
        res,
        items.map((c) => ({
          cityId: c.cityId,
          name: c.name,
          countryCode: c.countryCode,
          state: c.state,
          hotelCount: c.hotelCount ?? null,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Search ──────────

// Mock adapter is instantiated once and reused — it's stateless and
// deterministic-seeded per request, so concurrent requests don't interfere.
const mockHotels = new MockHotelAdapter();

async function buildMockSearchResponse(
  body: ReturnType<typeof HotelAvailRequestSchema.parse>,
  reason: string,
) {
  logger.warn({ method: 'hotels.search', reason }, 'hotels: using mock fallback');
  const cityName =
    body.destination.type === 'city'
      ? (
          await TboCity.findOne({ cityId: body.destination.cityId })
            .select('name')
            .lean()
        )?.name ?? 'Destination'
      : 'Destination';
  const totalGuests = body.rooms.reduce((n, r) => n + r.adults + r.children, 0);
  const results = await mockHotels.search({
    destination: cityName,
    checkIn: new Date(body.checkIn),
    checkOut: new Date(body.checkOut),
    rooms: body.rooms.length,
    guests: totalGuests,
    nationality: body.guestNationality,
  });
  return { searchId: randomUUID(), results };
}

hotelsRouter.post(
  '/search',
  searchAgencyLimit,
  validate(HotelAvailRequestSchema),
  async (req, res, next) => {
    const body = req.body as ReturnType<typeof HotelAvailRequestSchema.parse>;
    try {
      const out = await searchHotels(body, {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        agencyId: req.auth!.agencyId ?? null,
      });
      // The TBO search service returns `{ offers, errors, ... }` — a different
      // shape from the legacy `{ searchId, results: HotelOption[] }` that the
      // web's hotel pages read. Until the TBO Hotel API is provisioned and we
      // can write a real HotelOffer→HotelOption mapper against live response
      // payloads, fall back to mock hotels whenever TBO returns zero offers
      // (which is every call right now: HotelCodeList sync 401s, so
      // tbo_hotels stays empty and the search short-circuits to NO_HOTELS).
      if (!out.offers || out.offers.length === 0) {
        const reason = out.errors?.[0]?.code ?? 'tbo-zero-offers';
        return ok(res, await buildMockSearchResponse(body, reason));
      }
      // Real TBO data path. The web's HotelSearchResponse expects HotelOption[];
      // until a HotelOffer→HotelOption mapper is written, surface offers raw and
      // log a clear warning so this regression is loud.
      logger.warn(
        { method: 'hotels.search', offers: out.offers.length },
        'hotels: TBO returned offers — UI mapper not yet implemented (HotelOffer→HotelOption)',
      );
      return ok(res, out);
    } catch (err) {
      // TBO_INVALID_CREDENTIALS is the expected failure mode while Hotel API
      // is being provisioned. Anything else is a real bug and should bubble.
      if (err instanceof TboError && err.code === 'TBO_INVALID_CREDENTIALS') {
        return ok(res, await buildMockSearchResponse(body, 'tbo-invalid-credentials'));
      }
      next(err);
    }
  },
);

// ────────── PreBook ──────────

// PreBook needs the search-time HotelOffer + stay window — the frontend
// passes both back so we don't have to round-trip cache lookups under load.
const PreBookBodySchema = HotelPreBookRequestSchema.extend({
  searchOffer: HotelOfferSchema,
  stay: z.object({
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rooms: z
      .array(
        z.object({
          adults: z.number().int().min(1).max(9),
          children: z.number().int().min(0).max(9),
          childrenAges: z.array(z.number().int().min(0).max(17)).default([]),
        }),
      )
      .min(1),
  }),
});

hotelsRouter.post('/prebook', validate(PreBookBodySchema), async (req, res, next) => {
  try {
    const body = req.body as ReturnType<typeof PreBookBodySchema.parse>;
    const out = await preBookHotel(
      {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        agencyId: req.auth!.agencyId ?? null,
        distributorId: req.auth!.distributorId ?? null,
      },
      {
        offerId: body.offerId,
        searchOffer: body.searchOffer,
        stay: body.stay,
      },
    );
    return ok(res, out);
  } catch (err) {
    next(err);
  }
});

// ────────── DRAFT lookup ──────────

// Used by the frontend booking-form page to render guest fields based on
// supplierRules saved at PreBook time. Scopes by tenant + agency to prevent
// cross-tenant leakage of someone else's draft.
hotelsRouter.get('/draft/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const filter: Record<string, unknown> = {
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
      status: 'DRAFT',
    };
    if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
      filter.agencyId = req.auth!.agencyId;
    }
    const doc = await HotelBooking.findOne(filter).lean();
    if (!doc) throw new AppError('NOT_FOUND');
    return ok(res, {
      draftBookingId: String(doc._id),
      hotel: doc.hotel,
      checkIn: doc.checkIn,
      checkOut: doc.checkOut,
      nights: doc.nights,
      rooms: doc.rooms,
      pricing: doc.pricing,
      taxBreakup: doc.taxBreakup,
      cancellationPolicies: doc.cancellationPolicies,
      isRefundable: doc.isRefundable,
      lastCancellationDate: doc.lastCancellationDate,
      supplierRules: doc.supplierRules,
      isPriceChanged: doc.isPriceChanged,
      isCancellationPolicyChanged: doc.isCancellationPolicyChanged,
    });
  } catch (err) {
    next(err);
  }
});

// ────────── Book ──────────

const BookGuestSchema = z.object({
  title: z.enum(['Mr', 'Mrs', 'Miss', 'Ms']),
  firstName: z.string().min(1).max(60),
  middleName: z.string().max(60).optional().nullable(),
  lastName: z.string().min(1).max(60),
  paxType: z.enum(['Adult', 'Child']),
  age: z.number().int().min(0).max(120).optional().nullable(),
  isLeadPassenger: z.boolean().optional(),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email().optional().nullable(),
  pan: z.string().min(10).max(10).optional().nullable(),
  passportNo: z.string().max(20).optional().nullable(),
  passportIssueDate: z.string().optional().nullable(),
  passportExpDate: z.string().optional().nullable(),
});

const BookBodySchema = z.object({
  draftBookingId: z.string().min(1),
  guests: z.array(BookGuestSchema).min(1).max(40),
  isVoucherBooking: z.boolean(),
  gst: z
    .object({
      gstin: z.string().min(15).max(15),
      companyName: z.string().min(1).max(200),
      companyAddress: z.string().min(1).max(500),
      companyEmail: z.string().email().optional(),
      companyPhone: z.string().max(20).optional(),
    })
    .optional(),
  // Corporate tagging — optional, forwarded to the booking row for finance
  // reports. Validated as plain strings; agency-side validation (must match
  // an agency.costCentres entry) lands in the policy guard later.
  costCentreCode: z.string().min(1).max(20).optional(),
  glCode: z.string().min(1).max(20).optional(),
  projectCode: z.string().min(1).max(40).optional(),
});

hotelsRouter.post(
  '/book',
  bookingAgencyLimit,
  requirePermission('booking:create'),
  validate(BookBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof BookBodySchema.parse>;
      if (!req.auth!.agencyId) {
        throw new AppError('FORBIDDEN', { reason: 'no agency context' });
      }
      const result = await bookHotel(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        body,
      );
      // Use 201 only for the terminal-confirmed kinds; held/pending/verify
      // use 200 since the booking isn't finalised.
      if (result.kind === 'confirmed') return created(res, result);
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Voucher (admin/manual) ──────────

hotelsRouter.post(
  '/bookings/:id/voucher',
  requirePermission('booking:create'),
  async (req, res, next) => {
    try {
      const result = await voucherHotelBooking(req.params.id, {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        role: req.auth!.role,
        agencyId: req.auth!.agencyId ?? null,
      });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Cancel ──────────

const CancelBodySchema = z.object({
  remarks: z.string().min(1).max(500),
});

hotelsRouter.post(
  '/bookings/:id/cancel',
  requirePermission('booking:cancel'),
  validate(CancelBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof CancelBodySchema.parse>;
      const result = await requestCancel(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId ?? null,
          ipAddress: req.ip ?? null,
        },
        { bookingId: req.params.id, remarks: body.remarks },
      );
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Booking list ──────────
//
// GET /api/v1/hotels/bookings — paginated, filtered list. Mounted BEFORE
// the /:id routes so the static /bookings path takes precedence (Express
// matches routes in declaration order).
//
// Auth scope mirrors the rest of the agency-scoped read paths:
//   AGENCY/SUB_AGENT → only their own agency's bookings
//   DISTRIBUTOR     → only their downline
//   SUPER_ADMIN     → all in tenant

hotelsRouter.get(
  '/bookings',
  validate(HotelBookingListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof HotelBookingListQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };

      if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
        filter.agencyId = req.auth!.agencyId;
      } else if (req.auth!.role === 'DISTRIBUTOR') {
        filter.distributorId = req.auth!.distributorId;
      }

      // Status — accept either single or CSV-wrapped array.
      if (q.status) {
        filter.status = Array.isArray(q.status) ? { $in: q.status } : q.status;
      }

      // Free-text search — booking code OR hotel name OR confirmation no.
      // Booking code is sparse-indexed (case-sensitive); the others use
      // case-insensitive regex which is fine at our row counts.
      if (q.q) {
        const re = new RegExp(escapeRegex(q.q), 'i');
        filter.$or = [
          { bookingCode: re },
          { 'hotel.name': re },
          { 'supplierRefs.confirmationNo': re },
          { 'supplierRefs.bookingCode': re },
        ];
      }

      // Date range filters apply to check-in.
      if (q.from || q.to) {
        const range: Record<string, Date> = {};
        if (q.from) range.$gte = q.from;
        if (q.to) range.$lte = q.to;
        filter.checkIn = range;
      }

      if (q.costCentreCode) filter.costCentreCode = q.costCentreCode;
      if (q.glCode) filter.glCode = q.glCode;
      if (q.projectCode) filter.projectCode = q.projectCode;

      const [items, total] = await Promise.all([
        HotelBooking.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .select(
            'bookingCode status supplier supplierRefs hotel checkIn checkOut nights pricing isRefundable lastCancellationDate costCentreCode glCode projectCode bookedAt confirmedAt cancelledAt createdAt',
          )
          .lean(),
        HotelBooking.countDocuments(filter),
      ]);

      return ok(
        res,
        items.map((b) => ({
          id: String(b._id),
          bookingCode: b.bookingCode,
          status: b.status,
          supplier: b.supplier,
          supplierRefs: b.supplierRefs,
          hotel: b.hotel,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          nights: b.nights,
          totalSellingPaise: b.pricing?.totalSellingPaise ?? 0,
          isRefundable: b.isRefundable,
          lastCancellationDate: b.lastCancellationDate,
          costCentreCode: b.costCentreCode,
          glCode: b.glCode,
          projectCode: b.projectCode,
          bookedAt: b.bookedAt,
          confirmedAt: b.confirmedAt,
          cancelledAt: b.cancelledAt,
          createdAt: b.createdAt,
        })),
        {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.ceil(total / q.limit),
        },
      );
    } catch (err) {
      next(err);
    }
  },
);

hotelsRouter.get('/bookings/:id/cancel-status', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const job = await HotelCancellationJob.findOne({
      bookingId: req.params.id,
      tenantId: req.auth!.tenantId,
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!job) throw new AppError('NOT_FOUND');
    return ok(res, {
      jobId: String(job._id),
      changeRequestId: job.changeRequestId,
      changeRequestStatus: job.changeRequestStatus,
      cancellationChargePaise: job.cancellationChargePaise,
      refundAmountPaise: job.refundAmountPaise,
      refundCreditedAt: job.refundCreditedAt,
      pollAttempts: job.pollAttempts,
      lastPolledAt: job.lastPolledAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    next(err);
  }
});

// ────────── Booking detail (read + optional supplier sync) ──────────

const BookingDetailQuerySchema = z.object({
  refresh: z.coerce.boolean().default(false),
});

hotelsRouter.get(
  '/bookings/:id',
  validate(BookingDetailQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter: Record<string, unknown> = {
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      };
      if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
        filter.agencyId = req.auth!.agencyId;
      }
      const booking = await HotelBooking.findOne(filter);
      if (!booking) throw new AppError('NOT_FOUND');

      const { refresh } = req.query as unknown as ReturnType<
        typeof BookingDetailQuerySchema.parse
      >;
      let supplierState: ReturnType<typeof mapBookingDetailResponse> | null = null;
      if (refresh && booking.supplierRefs?.bookingId) {
        try {
          const { raw } = await fetchBookingDetail(req.params.id);
          supplierState = mapBookingDetailResponse(raw);
          booking.rawResponses = { ...(booking.rawResponses ?? {}), bookingDetail: raw };
          await booking.save();
        } catch (err) {
          // Don't fail the read if the supplier sync fails — surface it.
          supplierState = {
            kind: 'failed',
            error: { code: 'SYNC_FAILED', message: err instanceof Error ? err.message : 'unknown' },
          };
        }
      }

      return ok(res, {
        id: String(booking._id),
        bookingCode: booking.bookingCode,
        status: booking.status,
        statusHistory: booking.statusHistory,
        supplier: booking.supplier,
        supplierRefs: booking.supplierRefs,
        hotel: booking.hotel,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
        rooms: booking.rooms,
        guests: booking.guests,
        pricing: booking.pricing,
        taxBreakup: booking.taxBreakup,
        cancellationPolicies: booking.cancellationPolicies,
        isRefundable: booking.isRefundable,
        lastCancellationDate: booking.lastCancellationDate,
        gst: booking.gst,
        bookedAt: booking.bookedAt,
        confirmedAt: booking.confirmedAt,
        vouchredAt: booking.vouchredAt,
        cancelledAt: booking.cancelledAt,
        isPriceChanged: booking.isPriceChanged,
        isCancellationPolicyChanged: booking.isCancellationPolicyChanged,
        supplierState,
      });
    } catch (err) {
      next(err);
    }
  },
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
