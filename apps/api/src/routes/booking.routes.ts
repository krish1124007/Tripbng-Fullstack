import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  BookingListQuerySchema,
  CancelBookingRequestSchema,
  ConfirmBookingRequestSchema,
  HoldRequestSchema,
  IssueManuallyRequestSchema,
  ManualRefundRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { Booking } from '../models/Booking.js';
import { HotelBooking, type HotelBookingDoc } from '../models/HotelBooking.js';
import { HolidayBooking, type HolidayBookingDoc } from '../models/HolidayBooking.js';
import { VisaBooking, type VisaBookingDoc } from '../models/VisaBooking.js';
import { BusBooking, type BusBookingDoc } from '../models/BusBooking.js';
import { InsurancePolicy, type InsurancePolicyDoc } from '../models/InsurancePolicy.js';
import { User } from '../models/User.js';
import {
  cancelBooking,
  confirmBooking,
  holdBooking,
  issueManually,
  serializeBooking,
} from '../services/booking.service.js';
import {
  generateETicketPdf,
  generateHolidayInvoicePdf,
  generateHotelInvoicePdf,
  generateInvoicePdf,
  generateVisaInvoicePdf,
} from '../services/booking-pdf.js';
import { bookingAgencyLimit } from '../middleware/agency-rate-limit.js';
import { requireNotFrozen } from '../middleware/cutover-freeze.js';
import { containsRegex, escapeRegex, prefixRegex } from '../utils/regex.js';
import {
  bannerSnapshotFromDoc,
  selectBannerForBooking,
} from '../services/ticket/bannerSelector.js';
import { verifyTicketSignature } from '../services/notifications/whatsapp.service.js';
import {
  generateInvoiceForFlightBooking,
  getInvoiceForFlightBooking,
} from '../services/flight/invoice.service.js';
import { renderFlightInvoicePdf } from '../services/flight/invoice-pdf.js';
import { FlightInvoice } from '../models/FlightInvoice.js';
import { adjustWallet } from '../services/wallet/adjust.js';

export const bookingRouter: RouterT = Router();

// Signed-URL ticket download — runs BEFORE the authenticate middleware so
// recipients (e.g. via WhatsApp) can fetch the e-ticket PDF without a JWT.
// When sig+exp are absent we fall through to the authenticated handler below.
bookingRouter.get('/:id/ticket', async (req, res, next) => {
  const sig = typeof req.query.sig === 'string' ? req.query.sig : null;
  const exp = typeof req.query.exp === 'string' ? req.query.exp : null;
  if (!sig || !exp) return next('route'); // fall to the auth-protected handler

  if (!Types.ObjectId.isValid(req.params.id)) return next(new AppError('NOT_FOUND'));
  if (!verifyTicketSignature(req.params.id, sig, exp)) {
    return next(new AppError('TOKEN_INVALID', { reason: 'invalid or expired signature' }));
  }
  try {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new AppError('NOT_FOUND');
    if (b.status !== 'TICKETED') {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'ticket only available for TICKETED bookings',
      });
    }
    const bannerSnapshot = b.ticketTemplate?.bannerSnapshot;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ticket-${b.bookingCode}.pdf"`);
    const stream = await generateETicketPdf(b, {
      banner: bannerSnapshot?.bannerId
        ? {
            imageUrl: bannerSnapshot.imageUrl,
            href: bannerSnapshot.href,
            title: bannerSnapshot.title,
          }
        : null,
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

bookingRouter.use(authenticate, requireAuth);

bookingRouter.post(
  '/hold',
  requireNotFrozen('booking'),
  bookingAgencyLimit,
  requirePermission('booking:create'),
  validate(HoldRequestSchema),
  async (req, res, next) => {
    try {
      // Bookings always settle against an agency wallet. SUPER_ADMIN
      // accounts have no agencyId by design (they manage the platform,
      // not customers) — without one, `holdBooking()` would crash
      // trying to cast '' to a Mongoose ObjectId. Surface a clean
      // 400 with a helpful message instead.
      if (!req.auth!.agencyId) {
        throw new AppError('VALIDATION_ERROR', {
          reason:
            'Bookings require an agency wallet context. Log in as an agency user (e.g. agency1@tripbng.dev) to create bookings.',
        });
      }
      const booking = await holdBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        req.body as ReturnType<typeof HoldRequestSchema.parse>,
      );
      return created(res, serializeBooking(booking));
    } catch (err) {
      next(err);
    }
  },
);

bookingRouter.post(
  '/confirm',
  requireNotFrozen('booking'),
  bookingAgencyLimit,
  requirePermission('booking:create'),
  validate(ConfirmBookingRequestSchema),
  async (req, res, next) => {
    try {
      // Same agency-context guard as /hold — confirmation pulls funds
      // from the agency wallet, which doesn't exist for SUPER_ADMIN.
      if (!req.auth!.agencyId) {
        throw new AppError('VALIDATION_ERROR', {
          reason:
            'Bookings require an agency wallet context. Log in as an agency user (e.g. agency1@tripbng.dev) to settle bookings.',
        });
      }
      const booking = await confirmBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        req.body as ReturnType<typeof ConfirmBookingRequestSchema.parse>,
      );

      // Multi-channel notification (email + WA + in-app) is fired inside
      // confirmBooking() via the alert dispatch queue — see services/alerts.

      return ok(res, serializeBooking(booking));
    } catch (err) {
      next(err);
    }
  },
);

// Build the role-aware list filter once — admins see all, distributors their downline,
// agencies and sub-agents their own.
import type { AuthContext } from '../middleware/auth.js';
function listFilter(auth: AuthContext): Record<string, unknown> {
  const filter: Record<string, unknown> = { tenantId: auth.tenantId };
  if (auth.role === 'AGENCY' || auth.role === 'SUB_AGENT') {
    filter.agencyId = auth.agencyId;
  } else if (auth.role === 'DISTRIBUTOR') {
    filter.distributorId = auth.distributorId;
  }
  return filter;
}

bookingRouter.get('/', validate(BookingListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as ReturnType<typeof BookingListQuerySchema.parse>;
    const filter = listFilter(req.auth!);
    if (q.status) filter.status = q.status;
    if (q.q) {
      const re = containsRegex(q.q);
      const sectorRe = new RegExp(escapeRegex(q.q.trim().toUpperCase()));
      if (re) {
        filter.$or = [
          { bookingCode: re },
          { pnr: re },
          { sector: sectorRe },
        ];
      }
    }
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      filter.travelDate = range;
    }

    // Hotel-booking filter mirrors the flight filter, including a
    // status-tab translation. The UI sends flight-shaped status values
    // ('HOLD', 'TICKETED', 'CANCELLED', 'EXPIRED', 'FAILED'); we map
    // them to the corresponding HotelBooking statuses so the user gets
    // unified results when they click a tab. Statuses with no hotel
    // equivalent (EXPIRED — hotels don't expire) drop hotel rows from
    // that tab cleanly via skipHotels.
    const FLIGHT_TO_HOTEL_STATUSES: Record<string, string[] | null> = {
      INITIATED: ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'],
      HOLD: ['HELD'],
      PAYMENT_PENDING: ['PENDING_SUPPLIER'],
      TICKETING_IN_PROGRESS: ['PENDING_SUPPLIER'],
      CONFIRMED: ['CONFIRMED', 'VOUCHERED'],
      TICKETED: ['CONFIRMED', 'VOUCHERED'],
      PENDING_MANUAL: null, // flight-only state
      CANCEL_REQUESTED: ['CANCEL_REQUESTED', 'CANCEL_PROCESSING'],
      CANCELLED: ['CANCELLED'],
      REFUND_PENDING: null,
      REFUNDED: null,
      FAILED: ['BOOK_FAILED'],
      EXPIRED: null,
    };
    const hotelFilter: Record<string, unknown> = listFilter(req.auth!);
    {
      const re = containsRegex(q.q);
      if (re) {
        hotelFilter.$or = [
          { bookingCode: re },
          { 'hotel.name': re },
          { 'supplierRefs.confirmationNo': re },
        ];
      }
    }
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      hotelFilter.checkIn = range;
    }
    // Translate the flight-status tab → hotel statuses. If the tab has
    // no hotel equivalent (e.g. EXPIRED), skip the hotel query entirely
    // so we don't dilute the result set with all hotels.
    let skipHotels = false;
    if (q.status) {
      const hotelStatuses = FLIGHT_TO_HOTEL_STATUSES[q.status];
      if (hotelStatuses === null) {
        skipHotels = true;
      } else if (hotelStatuses) {
        hotelFilter.status = { $in: hotelStatuses };
      }
    }

    // Holiday filter mirrors the hotel one. Holiday-status enum is its
    // own (DRAFT/CONFIRMED/CANCEL_REQUESTED/CANCELLED/BOOK_FAILED); we
    // map flight tabs to it the same way we did for hotels.
    const FLIGHT_TO_HOLIDAY_STATUSES: Record<string, string[] | null> = {
      INITIATED: ['DRAFT'],
      HOLD: null, // holidays don't hold
      PAYMENT_PENDING: null,
      TICKETING_IN_PROGRESS: null,
      CONFIRMED: ['CONFIRMED'],
      TICKETED: ['CONFIRMED'],
      PENDING_MANUAL: null,
      CANCEL_REQUESTED: ['CANCEL_REQUESTED'],
      CANCELLED: ['CANCELLED'],
      REFUND_PENDING: null,
      REFUNDED: null,
      FAILED: ['BOOK_FAILED'],
      EXPIRED: null,
    };
    const holidayFilter: Record<string, unknown> = listFilter(req.auth!);
    {
      const re = containsRegex(q.q);
      if (re) {
        holidayFilter.$or = [
          { bookingCode: re },
          { packageTitle: re },
          { destination: re },
          { 'supplierRefs.confirmationNo': re },
        ];
      }
    }
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      holidayFilter.departureDate = range;
    }
    let skipHolidays = false;
    if (q.status) {
      const mapped = FLIGHT_TO_HOLIDAY_STATUSES[q.status];
      if (mapped === null) {
        skipHolidays = true;
      } else if (mapped) {
        holidayFilter.status = { $in: mapped };
      }
    }

    // Visa filter — same translation pattern. Visa adds IN_PROCESS /
    // GRANTED / REJECTED which fall under the broad TICKETED bucket on
    // the unified list (any "active and committed" application).
    const FLIGHT_TO_VISA_STATUSES: Record<string, string[] | null> = {
      INITIATED: ['DRAFT'],
      HOLD: null,
      PAYMENT_PENDING: null,
      TICKETING_IN_PROGRESS: ['IN_PROCESS'],
      CONFIRMED: ['CONFIRMED', 'IN_PROCESS', 'GRANTED'],
      TICKETED: ['CONFIRMED', 'IN_PROCESS', 'GRANTED'],
      PENDING_MANUAL: null,
      CANCEL_REQUESTED: ['CANCEL_REQUESTED'],
      CANCELLED: ['CANCELLED'],
      REFUND_PENDING: null,
      REFUNDED: null,
      FAILED: ['BOOK_FAILED', 'REJECTED'],
      EXPIRED: null,
    };
    const visaFilter: Record<string, unknown> = listFilter(req.auth!);
    {
      const re = containsRegex(q.q);
      if (re) {
        visaFilter.$or = [
          { bookingCode: re },
          { productName: re },
          { countryName: re },
          { 'supplierRefs.applicationNo': re },
        ];
      }
    }
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      visaFilter.expectedTravelDate = range;
    }
    let skipVisa = false;
    if (q.status) {
      const mapped = FLIGHT_TO_VISA_STATUSES[q.status];
      if (mapped === null) {
        skipVisa = true;
      } else if (mapped) {
        visaFilter.status = { $in: mapped };
      }
    }

    // Bus filter — its own status enum (BLOCKED / BOOKED / FAILED /
    // CANCELLED / PARTIALLY_CANCELLED / OPERATOR_CANCELLED).
    const FLIGHT_TO_BUS_STATUSES: Record<string, string[] | null> = {
      INITIATED: ['BLOCKED'],
      HOLD: ['BLOCKED'],
      PAYMENT_PENDING: null,
      TICKETING_IN_PROGRESS: null,
      CONFIRMED: ['BOOKED'],
      TICKETED: ['BOOKED'],
      PENDING_MANUAL: null,
      CANCEL_REQUESTED: null,
      CANCELLED: ['CANCELLED', 'PARTIALLY_CANCELLED', 'OPERATOR_CANCELLED'],
      REFUND_PENDING: null,
      REFUNDED: null,
      FAILED: ['FAILED'],
      EXPIRED: null,
    };
    const busFilter: Record<string, unknown> = listFilter(req.auth!);
    {
      const re = containsRegex(q.q);
      if (re) {
        busFilter.$or = [
          { bookingRef: re },
          { tin: re },
          { pnr: re },
          { 'trip.sourceCityName': re },
          { 'trip.destinationCityName': re },
        ];
      }
    }
    if (q.from || q.to) {
      // Bus stores doj as "yyyy-MM-dd" string, so we can't do a Date range
      // here directly. We compare as strings — works because ISO date sort
      // and lexical sort agree.
      const range: Record<string, string> = {};
      if (q.from) range.$gte = q.from.toISOString().slice(0, 10);
      if (q.to) range.$lte = q.to.toISOString().slice(0, 10);
      busFilter['trip.doj'] = range;
    }
    let skipBus = false;
    if (q.status) {
      const mapped = FLIGHT_TO_BUS_STATUSES[q.status];
      if (mapped === null) {
        skipBus = true;
      } else if (mapped) {
        busFilter.status = { $in: mapped };
      }
    }

    // Insurance filter — tiny status enum (ISSUED / ENDORSED /
    // CANCELLED). Insurance is tenant-scoped not agency-scoped (the
    // InsurancePolicy model has no agencyId), so for AGENCY / SUB_AGENT
    // we constrain to policies created by anyone in this agency via a
    // User join. ADMIN / SUPER_ADMIN see every policy in the tenant.
    const FLIGHT_TO_INSURANCE_STATUSES: Record<string, string[] | null> = {
      INITIATED: null, // insurance is issued in one shot — no draft state
      HOLD: null,
      PAYMENT_PENDING: null,
      TICKETING_IN_PROGRESS: null,
      CONFIRMED: ['ISSUED', 'ENDORSED'],
      TICKETED: ['ISSUED', 'ENDORSED'],
      PENDING_MANUAL: null,
      CANCEL_REQUESTED: null,
      CANCELLED: ['CANCELLED'],
      REFUND_PENDING: null,
      REFUNDED: null,
      FAILED: null, // failed issuances don't persist a row
      EXPIRED: null,
    };
    const insuranceFilter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(req.auth!.tenantId),
    };
    if (
      (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') &&
      req.auth!.agencyId
    ) {
      const agencyUsers = await User.find(
        {
          tenantId: new Types.ObjectId(req.auth!.tenantId),
          agencyId: new Types.ObjectId(req.auth!.agencyId),
        },
        { _id: 1 },
      ).lean();
      insuranceFilter.createdBy = { $in: agencyUsers.map((u) => u._id) };
    }
    {
      const re = containsRegex(q.q);
      if (re) {
        insuranceFilter.$or = [
          { policyNumber: re },
          { orderId: re },
          { insurerName: re },
          { planName: re },
        ];
      }
    }
    // No travelDate on InsurancePolicy — startDate/endDate live in
    // quotationSnapshot. Skip date-range filtering for insurance for
    // now; the typical query is "show me my policies" without dates.
    let skipInsurance = false;
    if (q.status) {
      const mapped = FLIGHT_TO_INSURANCE_STATUSES[q.status];
      if (mapped === null) {
        skipInsurance = true;
      } else if (mapped) {
        insuranceFilter.status = { $in: mapped };
      }
    }

    // Fetch a generous slice from each collection, then merge + paginate in
    // memory. This is fine for dev/agency scales (typically <1000 bookings
    // per agency); when we grow past that we'll need a proper cursor-based
    // merge or a unified Bookings collection.
    const fetchLimit = q.page * q.limit;
    const [
      flights,
      hotels,
      holidays,
      visas,
      buses,
      insurances,
      flightTotal,
      hotelTotal,
      holidayTotal,
      visaTotal,
      busTotal,
      insuranceTotal,
    ] = await Promise.all([
      Booking.find(filter).sort({ createdAt: -1 }).limit(fetchLimit),
      skipHotels
        ? Promise.resolve<HotelBookingDoc[]>([])
        : HotelBooking.find(hotelFilter).sort({ createdAt: -1 }).limit(fetchLimit),
      skipHolidays
        ? Promise.resolve<HolidayBookingDoc[]>([])
        : HolidayBooking.find(holidayFilter).sort({ createdAt: -1 }).limit(fetchLimit),
      skipVisa
        ? Promise.resolve<VisaBookingDoc[]>([])
        : VisaBooking.find(visaFilter).sort({ createdAt: -1 }).limit(fetchLimit),
      skipBus
        ? Promise.resolve<BusBookingDoc[]>([])
        : BusBooking.find(busFilter).sort({ createdAt: -1 }).limit(fetchLimit),
      skipInsurance
        ? Promise.resolve<InsurancePolicyDoc[]>([])
        : InsurancePolicy.find(insuranceFilter).sort({ createdAt: -1 }).limit(fetchLimit),
      Booking.countDocuments(filter),
      skipHotels ? Promise.resolve(0) : HotelBooking.countDocuments(hotelFilter),
      skipHolidays ? Promise.resolve(0) : HolidayBooking.countDocuments(holidayFilter),
      skipVisa ? Promise.resolve(0) : VisaBooking.countDocuments(visaFilter),
      skipBus ? Promise.resolve(0) : BusBooking.countDocuments(busFilter),
      skipInsurance ? Promise.resolve(0) : InsurancePolicy.countDocuments(insuranceFilter),
    ]);

    const merged = [
      ...flights.map((b) => ({ at: b.createdAt, item: serializeBooking(b) })),
      ...hotels.map((h) => ({ at: h.createdAt, item: serializeHotelBookingAsPublic(h) })),
      ...holidays.map((h) => ({ at: h.createdAt, item: serializeHolidayBookingAsPublic(h) })),
      ...visas.map((v) => ({ at: v.createdAt, item: serializeVisaBookingAsPublic(v) })),
      ...buses.map((b) => ({ at: b.createdAt, item: serializeBusBookingAsPublic(b) })),
      ...insurances.map((p) => ({
        at: p.createdAt,
        item: serializeInsurancePolicyAsPublic(p),
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice((q.page - 1) * q.limit, q.page * q.limit)
      .map((r) => r.item);

    const total =
      flightTotal + hotelTotal + holidayTotal + visaTotal + busTotal + insuranceTotal;
    return ok(res, merged, {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Map a HotelBooking row into the PublicBooking shape the web's unified
 * /bookings list expects. We synthesize the flight-shaped fields with
 * hotel-appropriate values so the existing UI columns (sector, travel
 * date, pax, total, status badge) render without code churn. The
 * `productType: 'HOTEL'` field is the discriminator if the UI wants to
 * branch on it (e.g. icon swap).
 */
function serializeHotelBookingAsPublic(h: HotelBookingDoc): Record<string, unknown> {
  // Map hotel status → flight-shaped enum so the existing StatusBadge
  // component picks the right colour. Hotel statuses VOUCHERED / CONFIRMED
  // both surface as TICKETED (the "everything went through" green state);
  // BOOK_FAILED → FAILED; HELD → HOLD; CANCELLED → CANCELLED.
  const hotelToFlightStatus: Record<string, string> = {
    DRAFT: 'INITIATED',
    AWAITING_APPROVAL: 'INITIATED',
    APPROVED: 'INITIATED',
    BOOK_FAILED: 'FAILED',
    HELD: 'HOLD',
    PENDING_SUPPLIER: 'PAYMENT_PENDING',
    CONFIRMED: 'TICKETED',
    VOUCHERED: 'TICKETED',
    CANCEL_REQUESTED: 'CANCEL_REQUESTED',
    CANCEL_PROCESSING: 'CANCEL_REQUESTED',
    CANCELLED: 'CANCELLED',
    CANCEL_REJECTED: 'CONFIRMED',
  };

  return {
    id: String(h._id),
    bookingCode: h.bookingCode ?? `HTL-${String(h._id).slice(-6)}`,
    status: hotelToFlightStatus[h.status] ?? 'CONFIRMED',
    channel: 'ONLINE',
    flowSubType: 'HOTEL',
    productType: 'HOTEL',

    pnr: h.supplierRefs?.confirmationNo ?? null,
    airlinePnr: null,
    ticketNumbers: [],

    agencyId: h.agencyId ? String(h.agencyId) : '',
    agencyCode: '',
    agencyName: h.hotel?.name ?? '',
    distributorId: h.distributorId ? String(h.distributorId) : null,
    bookedByUserId: String(h.bookedByUserId),

    // Show "HOTEL · {city}" in the sector column.
    sector: `HOTEL · ${h.hotel?.address ?? h.hotel?.name ?? '—'}`,
    travelDate: h.checkIn.toISOString(),
    returnDate: h.checkOut.toISOString(),
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',

    segments: [],
    passengers: (h.guests ?? []).map((g) => ({
      type: g.paxType === 'Child' ? 'CHILD' : 'ADULT',
      title: g.title ?? 'MR',
      firstName: g.firstName ?? '',
      lastName: g.lastName ?? '',
      ticketNumber: null,
      fareCategory: 'REGULAR',
    })),
    contact: {
      email: h.guests?.[0]?.email ?? '',
      mobile: h.guests?.[0]?.phone ?? '',
      countryCode: '+91',
    },
    gst: h.gst?.gstin
      ? {
          number: h.gst.gstin,
          companyName: h.gst.companyName ?? '',
          address: h.gst.companyAddress ?? '',
        }
      : null,

    pricing: {
      baseFarePaise: h.pricing?.totalSellingPaise ?? 0,
      taxesPaise: 0,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 0,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 0,
      discountPaise: 0,
      gstPaise: 0,
      grossAmountPaise: h.pricing?.totalSellingPaise ?? 0,
      netToSupplierPaise: h.pricing?.totalNetPaise ?? 0,
      agencyPayablePaise: h.pricing?.totalSellingPaise ?? 0,
      distributorEarningsPaise: 0,
      platformEarningsPaise: 0,
      currency: 'INR',
    },
    pricingTrace: [],

    paymentMode: 'WALLET',
    paymentStatus: ['VOUCHERED', 'CONFIRMED'].includes(h.status) ? 'PAID' : 'PENDING',

    initiatedAt: h.createdAt.toISOString(),
    heldAt: null,
    ticketedAt: h.vouchredAt?.toISOString() ?? h.confirmedAt?.toISOString() ?? null,
    voidWindowEndsAt: null,
    cancelledAt: h.cancelledAt?.toISOString() ?? null,
    expiresAt: null,
    refundedAt: null,
    internalNotes: null,

    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

/**
 * Map a HolidayBooking row into the PublicBooking shape the web's unified
 * /bookings list expects. Same pattern as serializeHotelBookingAsPublic —
 * the row synthesizes flight-shaped fields with holiday-appropriate values,
 * and the productType='HOLIDAY' discriminator lets the UI swap render
 * paths (sector, status icons, detail layout).
 */
function serializeHolidayBookingAsPublic(h: HolidayBookingDoc): Record<string, unknown> {
  const HOLIDAY_TO_FLIGHT_STATUS: Record<string, string> = {
    DRAFT: 'INITIATED',
    CONFIRMED: 'TICKETED',
    CANCEL_REQUESTED: 'CANCEL_REQUESTED',
    CANCELLED: 'CANCELLED',
    BOOK_FAILED: 'FAILED',
  };
  return {
    id: String(h._id),
    bookingCode: h.bookingCode ?? `HOL-${String(h._id).slice(-6)}`,
    status: HOLIDAY_TO_FLIGHT_STATUS[h.status] ?? 'CONFIRMED',
    channel: 'ONLINE',
    flowSubType: 'HOLIDAY',
    productType: 'HOLIDAY',

    pnr: h.supplierRefs?.confirmationNo ?? null,
    airlinePnr: null,
    ticketNumbers: [],

    agencyId: h.agencyId ? String(h.agencyId) : '',
    agencyCode: '',
    agencyName: h.packageTitle,
    distributorId: h.distributorId ? String(h.distributorId) : null,
    bookedByUserId: String(h.bookedByUserId),

    sector: `HOLIDAY · ${h.destination ?? h.packageTitle}`,
    travelDate: h.departureDate.toISOString(),
    returnDate: h.returnDate.toISOString(),
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',

    segments: [],
    passengers: (h.travellers ?? []).map((g) => ({
      type: g.paxType === 'Child' ? 'CHILD' : 'ADULT',
      title: g.title ?? 'MR',
      firstName: g.firstName ?? '',
      lastName: g.lastName ?? '',
      ticketNumber: null,
      fareCategory: 'REGULAR',
    })),
    contact: {
      email: h.travellers?.[0]?.email ?? '',
      mobile: h.travellers?.[0]?.phone ?? '',
      countryCode: '+91',
    },
    gst: h.gst?.gstin
      ? {
          number: h.gst.gstin,
          companyName: h.gst.companyName ?? '',
          address: h.gst.companyAddress ?? '',
        }
      : null,

    pricing: {
      baseFarePaise: h.pricing?.subtotalPaise ?? 0,
      taxesPaise: h.pricing?.gstPaise ?? 0,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 0,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 0,
      discountPaise: 0,
      gstPaise: h.pricing?.gstPaise ?? 0,
      grossAmountPaise: h.pricing?.totalPaise ?? 0,
      netToSupplierPaise: h.pricing?.subtotalPaise ?? 0,
      agencyPayablePaise: h.pricing?.totalPaise ?? 0,
      distributorEarningsPaise: 0,
      platformEarningsPaise: 0,
      currency: 'INR',
    },
    pricingTrace: [],

    paymentMode: 'WALLET',
    paymentStatus: h.status === 'CONFIRMED' ? 'PAID' : 'PENDING',

    initiatedAt: h.createdAt.toISOString(),
    heldAt: null,
    ticketedAt: h.confirmedAt?.toISOString() ?? null,
    voidWindowEndsAt: null,
    cancelledAt: h.cancelledAt?.toISOString() ?? null,
    expiresAt: null,
    refundedAt: null,
    internalNotes: null,

    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

/**
 * Map a VisaBooking row into the PublicBooking shape. Same pattern as
 * holiday — synthesizes flight-shaped fields with visa-appropriate values
 * and uses productType='VISA' as the discriminator.
 */
function serializeVisaBookingAsPublic(v: VisaBookingDoc): Record<string, unknown> {
  const VISA_TO_FLIGHT_STATUS: Record<string, string> = {
    DRAFT: 'INITIATED',
    CONFIRMED: 'TICKETED',
    IN_PROCESS: 'TICKETED',
    GRANTED: 'TICKETED',
    REJECTED: 'FAILED',
    CANCEL_REQUESTED: 'CANCEL_REQUESTED',
    CANCELLED: 'CANCELLED',
    BOOK_FAILED: 'FAILED',
  };
  const travelDate = v.expectedTravelDate ?? v.createdAt;
  return {
    id: String(v._id),
    bookingCode: v.bookingCode ?? `VIS-${String(v._id).slice(-6)}`,
    status: VISA_TO_FLIGHT_STATUS[v.status] ?? 'CONFIRMED',
    channel: 'ONLINE',
    flowSubType: 'VISA',
    productType: 'VISA',

    pnr: v.supplierRefs?.applicationNo ?? null,
    airlinePnr: null,
    ticketNumbers: [],

    agencyId: v.agencyId ? String(v.agencyId) : '',
    agencyCode: '',
    agencyName: v.productName,
    distributorId: v.distributorId ? String(v.distributorId) : null,
    bookedByUserId: String(v.bookedByUserId),

    sector: `VISA · ${v.countryName ?? v.productName}`,
    travelDate: travelDate.toISOString(),
    returnDate: null,
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',

    segments: [],
    passengers: (v.applicants ?? []).map((a) => ({
      type: a.paxType === 'CHD' ? 'CHILD' : a.paxType === 'INF' ? 'INFANT' : 'ADULT',
      title: a.title ?? 'MR',
      firstName: a.firstName ?? '',
      lastName: a.lastName ?? '',
      ticketNumber: null,
      fareCategory: 'REGULAR',
    })),
    contact: {
      email: v.applicants?.[0]?.email ?? '',
      mobile: v.applicants?.[0]?.phone ?? '',
      countryCode: '+91',
    },
    gst: v.gst?.gstin
      ? {
          number: v.gst.gstin,
          companyName: v.gst.companyName ?? '',
          address: v.gst.companyAddress ?? '',
        }
      : null,

    pricing: {
      baseFarePaise: v.pricing?.subtotalPaise ?? 0,
      taxesPaise: v.pricing?.gstPaise ?? 0,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 0,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 0,
      discountPaise: 0,
      gstPaise: v.pricing?.gstPaise ?? 0,
      grossAmountPaise: v.pricing?.totalPaise ?? 0,
      netToSupplierPaise: v.pricing?.consulateFeePaise ?? 0,
      agencyPayablePaise: v.pricing?.totalPaise ?? 0,
      distributorEarningsPaise: 0,
      platformEarningsPaise: 0,
      currency: 'INR',
    },
    pricingTrace: [],

    paymentMode: 'WALLET',
    paymentStatus: ['CONFIRMED', 'IN_PROCESS', 'GRANTED'].includes(v.status)
      ? 'PAID'
      : 'PENDING',

    initiatedAt: v.createdAt.toISOString(),
    heldAt: null,
    ticketedAt: v.confirmedAt?.toISOString() ?? null,
    voidWindowEndsAt: null,
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    expiresAt: null,
    refundedAt: null,
    internalNotes: null,

    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/**
 * Map a BusBooking row into the PublicBooking shape. Bus has its own
 * dedicated /bus/* routes for the full booking surface (seat layout,
 * boarding-point picker, etc); this adapter is just the unified-list
 * read path. productType='BUS', sector = "source → destination",
 * travelDate = trip.doj (start of day IST), pax = passengers count.
 */
function serializeBusBookingAsPublic(b: BusBookingDoc): Record<string, unknown> {
  const BUS_TO_FLIGHT_STATUS: Record<string, string> = {
    BLOCKED: 'HOLD',
    BOOKED: 'TICKETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    PARTIALLY_CANCELLED: 'CANCELLED',
    OPERATOR_CANCELLED: 'CANCELLED',
  };
  // Trip.doj is "yyyy-MM-dd" IST. Parse as UTC midnight — the table
  // just shows the date string, no time zone games to worry about.
  const dojDate = new Date(`${b.trip?.doj}T00:00:00.000Z`);
  return {
    id: String(b._id),
    bookingCode: b.bookingRef,
    status: BUS_TO_FLIGHT_STATUS[b.status] ?? 'CONFIRMED',
    channel: 'ONLINE',
    flowSubType: 'BUS',
    productType: 'BUS',

    pnr: b.tin ?? b.pnr ?? null,
    airlinePnr: b.pnr ?? null,
    ticketNumbers: [],

    agencyId: b.agencyId ? String(b.agencyId) : '',
    agencyCode: '',
    agencyName: b.trip?.operatorName ?? '',
    distributorId: null,
    bookedByUserId: String(b.bookedByUserId),

    sector: `${b.trip?.sourceCityName ?? '?'} → ${b.trip?.destinationCityName ?? '?'}`,
    travelDate: dojDate.toISOString(),
    returnDate: null,
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',

    segments: [],
    passengers: (b.passengers ?? []).map((p) => ({
      type: p.age >= 12 ? 'ADULT' : p.age >= 2 ? 'CHILD' : 'INFANT',
      title: p.title ?? 'Mr',
      firstName: p.name?.split(/\s+/)[0] ?? '',
      lastName: p.name?.split(/\s+/).slice(1).join(' ') ?? '',
      ticketNumber: p.seatName ?? null,
      fareCategory: 'REGULAR',
    })),
    contact: {
      email: '',
      mobile: '',
      countryCode: '+91',
    },
    gst: null,

    pricing: {
      baseFarePaise: b.fareBreakup?.baseFarePaise ?? 0,
      taxesPaise: b.fareBreakup?.serviceTaxPaise ?? 0,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 0,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 0,
      discountPaise: 0,
      gstPaise: b.fareBreakup?.serviceTaxPaise ?? 0,
      grossAmountPaise: b.fareBreakup?.totalPaise ?? 0,
      netToSupplierPaise: b.fareBreakup?.baseFarePaise ?? 0,
      agencyPayablePaise: b.fareBreakup?.totalPaise ?? 0,
      distributorEarningsPaise: 0,
      platformEarningsPaise: 0,
      currency: 'INR',
    },
    pricingTrace: [],

    paymentMode: 'WALLET',
    paymentStatus: b.status === 'BOOKED' ? 'PAID' : b.status === 'CANCELLED' ? 'REFUNDED' : 'PENDING',

    initiatedAt: b.createdAt.toISOString(),
    heldAt: b.blockedAt?.toISOString() ?? null,
    ticketedAt: b.bookedAt?.toISOString() ?? null,
    voidWindowEndsAt: null,
    cancelledAt: b.cancelledAt?.toISOString() ?? b.operatorCancelledAt?.toISOString() ?? null,
    expiresAt: null,
    refundedAt: null,
    internalNotes: null,

    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

/**
 * Map an InsurancePolicy row into the PublicBooking shape. Insurance has
 * its own dedicated /insurance/* routes for the full purchase + lifecycle
 * surface (quote / validate / issue / endorse / cancel); this adapter
 * exists so policies show up on the unified /bookings list and detail
 * page alongside flight / hotel / holiday / visa / bus rows.
 *
 * Quirks vs other products:
 *  - No agencyId on the policy — agencyId is left empty and the list
 *    filter scopes by createdBy via a User join upstream.
 *  - travelDate = quotation.startDate (yyyy-MM-dd), returnDate = endDate.
 *  - "PNR slot" surfaces the policy number; UI relabels accordingly.
 *  - No passenger fare breakdown — totalPremiumPaise lands on every
 *    pricing field that needs a number, everything else is zeroed.
 */
function serializeInsurancePolicyAsPublic(
  p: InsurancePolicyDoc,
): Record<string, unknown> {
  const INSURANCE_TO_FLIGHT_STATUS: Record<string, string> = {
    ISSUED: 'TICKETED',
    ENDORSED: 'TICKETED',
    CANCELLED: 'CANCELLED',
  };
  const quotation = (p.quotationSnapshot ?? {}) as {
    startDate?: string;
    endDate?: string;
    destination?: string;
  };
  const startISO = quotation.startDate
    ? new Date(`${quotation.startDate}T00:00:00.000Z`).toISOString()
    : p.createdAt.toISOString();
  const endISO = quotation.endDate
    ? new Date(`${quotation.endDate}T00:00:00.000Z`).toISOString()
    : null;
  const travelers = Array.isArray(p.travelerSnapshot)
    ? (p.travelerSnapshot as Array<Record<string, unknown>>)
    : p.travelerSnapshot
      ? [p.travelerSnapshot as Record<string, unknown>]
      : [];
  const titleMap: Record<string, string> = {
    MR: 'Mr',
    MRS: 'Mrs',
    MS: 'Ms',
    MSTR: 'Mstr',
    MISS: 'Miss',
  };
  return {
    id: String(p._id),
    bookingCode: p.policyNumber,
    status: INSURANCE_TO_FLIGHT_STATUS[p.status] ?? 'CONFIRMED',
    channel: 'ONLINE',
    flowSubType: 'INSURANCE',
    productType: 'INSURANCE',

    pnr: p.policyNumber,
    airlinePnr: null,
    ticketNumbers: [p.policyNumber],

    agencyId: '',
    agencyCode: '',
    agencyName: p.insurerName ?? p.insurerId ?? 'Insurance',
    distributorId: null,
    bookedByUserId: String(p.createdBy ?? ''),

    sector: quotation.destination
      ? `Coverage · ${quotation.destination}`
      : `Coverage · ${p.planName ?? p.planId}`,
    travelDate: startISO,
    returnDate: endISO,
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',

    segments: [],
    passengers: travelers.map((t) => {
      const firstName = typeof t.firstName === 'string' ? t.firstName : '';
      const lastName = typeof t.lastName === 'string' ? t.lastName : '';
      const titleRaw = typeof t.title === 'string' ? t.title : 'MR';
      const paxType = typeof t.type === 'string' ? t.type : 'ADULT';
      return {
        type: paxType === 'CHILD' || paxType === 'INFANT' ? paxType : 'ADULT',
        title: titleMap[titleRaw] ?? 'Mr',
        firstName,
        lastName,
        ticketNumber: p.policyNumber,
        fareCategory: 'REGULAR',
      };
    }),
    contact: {
      email: typeof travelers[0]?.email === 'string' ? (travelers[0].email as string) : '',
      mobile:
        typeof travelers[0]?.mobileNo === 'string'
          ? (travelers[0].mobileNo as string)
          : '',
      countryCode: '+91',
    },
    gst: null,

    pricing: {
      baseFarePaise: p.totalPremiumPaise,
      taxesPaise: 0,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 0,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 0,
      discountPaise: 0,
      gstPaise: 0,
      grossAmountPaise: p.totalPremiumPaise,
      netToSupplierPaise: p.totalPremiumPaise,
      agencyPayablePaise: p.totalPremiumPaise,
      distributorEarningsPaise: 0,
      platformEarningsPaise: 0,
      currency: p.currency ?? 'INR',
    },
    pricingTrace: [],

    paymentMode: 'WALLET',
    paymentStatus: p.status === 'CANCELLED' ? 'REFUNDED' : 'PAID',

    initiatedAt: p.createdAt.toISOString(),
    heldAt: null,
    ticketedAt: p.createdAt.toISOString(),
    voidWindowEndsAt: null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    expiresAt: endISO,
    refundedAt:
      p.status === 'CANCELLED' && p.cancelledAt ? p.cancelledAt.toISOString() : null,
    internalNotes: null,

    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Insurance has no agencyId, so the standard listFilter (which adds
 * agencyId for AGENCY/SUB_AGENT) doesn't apply. Build the tenant-scoped
 * filter inline; for AGENCY/SUB_AGENT we then narrow to policies whose
 * createdBy is a user in their agency.
 */
async function findInsurancePolicyForActor(
  auth: AuthContext,
  id: string,
): Promise<InsurancePolicyDoc | null> {
  const policy = await InsurancePolicy.findOne({
    _id: id,
    tenantId: new Types.ObjectId(auth.tenantId),
  });
  if (!policy) return null;
  if ((auth.role === 'AGENCY' || auth.role === 'SUB_AGENT') && auth.agencyId) {
    const owner = await User.findOne(
      { _id: policy.createdBy, agencyId: new Types.ObjectId(auth.agencyId) },
      { _id: 1 },
    ).lean();
    if (!owner) return null;
  }
  return policy;
}

bookingRouter.get('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const filter = listFilter(req.auth!);
    filter._id = req.params.id;
    // Look up across all product collections in priority order. Detail
    // page reads PublicBooking and branches on productType.
    const b = await Booking.findOne(filter);
    if (b) return ok(res, serializeBooking(b));
    const h = await HotelBooking.findOne(filter);
    if (h) return ok(res, serializeHotelBookingAsPublic(h));
    const hol = await HolidayBooking.findOne(filter);
    if (hol) return ok(res, serializeHolidayBookingAsPublic(hol));
    const v = await VisaBooking.findOne(filter);
    if (v) return ok(res, serializeVisaBookingAsPublic(v));
    const bus = await BusBooking.findOne(filter);
    if (bus) return ok(res, serializeBusBookingAsPublic(bus));
    const insurance = await findInsurancePolicyForActor(req.auth!, req.params.id);
    if (insurance) return ok(res, serializeInsurancePolicyAsPublic(insurance));
    throw new AppError('NOT_FOUND');
  } catch (err) {
    next(err);
  }
});

bookingRouter.post(
  '/:id/cancel',
  requireNotFrozen('booking'),
  requirePermission('booking:cancel'),
  validate(CancelBookingRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as ReturnType<typeof CancelBookingRequestSchema.parse>;

      // Disambiguate flight vs hotel by collection. Flight cancel goes
      // through the full state-machine service; hotel + holiday cancels
      // for mock supplier are inline transitions + wallet credits (no
      // TBO round trip available without real creds).
      const filterScope = { _id: req.params.id, tenantId: req.auth!.tenantId };
      const flightExists = await Booking.exists(filterScope);
      const hotelExists = !flightExists && (await HotelBooking.exists(filterScope));
      const holidayExists =
        !flightExists && !hotelExists && (await HolidayBooking.exists(filterScope));
      const visaExists =
        !flightExists &&
        !hotelExists &&
        !holidayExists &&
        (await VisaBooking.exists(filterScope));
      const busExists =
        !flightExists &&
        !hotelExists &&
        !holidayExists &&
        !visaExists &&
        (await BusBooking.exists(filterScope));
      // Insurance is tenant-scoped, no agencyId on the doc — check
      // existence on tenant + _id only, then run the createdBy-in-
      // agency narrowing once we have the row.
      const insurancePolicyExists =
        !flightExists &&
        !hotelExists &&
        !holidayExists &&
        !visaExists &&
        !busExists &&
        (await InsurancePolicy.exists({
          _id: req.params.id,
          tenantId: new Types.ObjectId(req.auth!.tenantId),
        }));

      if (insurancePolicyExists) {
        const policy = await findInsurancePolicyForActor(req.auth!, req.params.id);
        if (!policy) throw new AppError('NOT_FOUND');
        if (policy.status === 'CANCELLED') {
          throw new AppError('VALIDATION_ERROR', {
            reason: 'policy already cancelled',
          });
        }
        // ASEGO cancel requires a structured reasonId UUID — the unified
        // cancel route only carries a free-text reason. Pick the first
        // ASEGO cancellation reason from the master list and forward the
        // user's free-text reason as remarks. Callers who need to pick
        // a specific reasonId can still hit POST /insurance/cancel
        // directly with the structured payload.
        const { listReasons } = await import('../services/insurance/master.service.js');
        const reasons = await listReasons('cancellation').catch(() => []);
        const reasonId = reasons[0]?.id;
        if (!reasonId) {
          throw new AppError('SUPPLIER_UNAVAILABLE', {
            reason:
              'ASEGO cancellation reasons unavailable — try POST /insurance/cancel directly',
          });
        }
        const { cancelPolicy } = await import('../services/insurance/cancel.service.js');
        await cancelPolicy(
          { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
          {
            policyNumber: policy.policyNumber,
            reasonId,
            remarks: body.reason?.slice(0, 240),
          },
        );
        // Re-fetch — cancelPolicy persisted status=CANCELLED + cancelledAt
        // on the doc, but we want the serializer to see the fresh values.
        const fresh = await InsurancePolicy.findById(policy._id);
        if (!fresh) throw new AppError('NOT_FOUND');
        return ok(res, serializeInsurancePolicyAsPublic(fresh));
      }

      if (busExists) {
        if (!req.auth!.agencyId) {
          throw new AppError('VALIDATION_ERROR', { reason: 'agency context required' });
        }
        // Delegate to the existing bus cancel service — it handles
        // SeatSeller round-trip, partial-cancel math, and wallet
        // refund with the right txnId linkage on BusBooking.
        const { cancelBooking: busCancelBooking } = await import(
          '../services/bus/cancellation.service.js'
        );
        const result = await busCancelBooking(
          {
            tenantId: req.auth!.tenantId,
            agencyId: req.auth!.agencyId,
            userId: req.auth!.userId,
            role: req.auth!.role,
            ipAddress: req.ip ?? null,
          },
          req.params.id,
          { note: body.reason ?? undefined },
        );
        return ok(res, serializeBusBookingAsPublic(result.booking));
      }

      if (visaExists) {
        if (!req.auth!.agencyId) {
          throw new AppError('VALIDATION_ERROR', { reason: 'agency context required' });
        }
        const filter = listFilter(req.auth!);
        filter._id = req.params.id;
        const v = await VisaBooking.findOne(filter);
        if (!v) throw new AppError('NOT_FOUND');
        if (['CANCELLED', 'CANCEL_REQUESTED', 'GRANTED', 'REJECTED'].includes(v.status)) {
          throw new AppError('VALIDATION_ERROR', {
            reason:
              v.status === 'CANCELLED'
                ? 'application already cancelled'
                : v.status === 'GRANTED'
                  ? 'visa already granted — cannot cancel'
                  : v.status === 'REJECTED'
                    ? 'application already rejected'
                    : 'cancel already in progress',
          });
        }
        // Full refund — real wiring would call the embassy/portal cancel
        // and walk cancellationSchedule for partials.
        const refundPaise = v.pricing?.totalPaise ?? 0;
        if (refundPaise > 0) {
          const { walletService } = await import('../services/payment/wallet.service.js');
          const wallet = await walletService.findOrCreateForAgency(
            new Types.ObjectId(req.auth!.tenantId),
            new Types.ObjectId(req.auth!.agencyId),
          );
          await walletService.credit({
            walletId: wallet._id,
            amount: refundPaise,
            type: 'REFUND_CREDIT',
            description: `Visa cancel ${v.bookingCode ?? String(v._id)} — ${v.productName}`,
            performedBy: new Types.ObjectId(req.auth!.userId),
            bookingId: v._id,
            idempotencyKey: `visa-cancel-${v._id.toHexString()}`,
            metadata: { reason: body.reason ?? 'agent-cancel' },
          });
        }
        v.status = 'CANCELLED';
        v.statusHistory.push({
          status: 'CANCELLED',
          at: new Date(),
          by: new Types.ObjectId(req.auth!.userId),
          note: body.reason?.slice(0, 200) ?? null,
        });
        v.cancelledAt = new Date();
        await v.save();
        return ok(res, serializeVisaBookingAsPublic(v));
      }

      if (holidayExists) {
        if (!req.auth!.agencyId) {
          throw new AppError('VALIDATION_ERROR', { reason: 'agency context required' });
        }
        const filter = listFilter(req.auth!);
        filter._id = req.params.id;
        const h = await HolidayBooking.findOne(filter);
        if (!h) throw new AppError('NOT_FOUND');
        if (['CANCELLED', 'CANCEL_REQUESTED'].includes(h.status)) {
          throw new AppError('VALIDATION_ERROR', { reason: 'booking already cancelled' });
        }
        // Full refund — real consolidator wiring would walk the
        // cancellationSchedule on the package to derive partials.
        const refundPaise = h.pricing?.totalPaise ?? 0;
        if (refundPaise > 0) {
          const { walletService } = await import('../services/payment/wallet.service.js');
          const wallet = await walletService.findOrCreateForAgency(
            new Types.ObjectId(req.auth!.tenantId),
            new Types.ObjectId(req.auth!.agencyId),
          );
          await walletService.credit({
            walletId: wallet._id,
            amount: refundPaise,
            type: 'REFUND_CREDIT',
            description: `Holiday cancel ${h.bookingCode ?? String(h._id)} — ${h.packageTitle}`,
            performedBy: new Types.ObjectId(req.auth!.userId),
            bookingId: h._id,
            idempotencyKey: `holiday-cancel-${h._id.toHexString()}`,
            metadata: { reason: body.reason ?? 'agent-cancel' },
          });
        }
        h.status = 'CANCELLED';
        h.statusHistory.push({
          status: 'CANCELLED',
          at: new Date(),
          by: new Types.ObjectId(req.auth!.userId),
          note: body.reason?.slice(0, 200) ?? null,
        });
        h.cancelledAt = new Date();
        await h.save();
        return ok(res, serializeHolidayBookingAsPublic(h));
      }

      if (hotelExists) {
        if (!req.auth!.agencyId) {
          throw new AppError('VALIDATION_ERROR', { reason: 'agency context required' });
        }
        const filter = listFilter(req.auth!);
        filter._id = req.params.id;
        const h = await HotelBooking.findOne(filter);
        if (!h) throw new AppError('NOT_FOUND');
        if (['CANCELLED', 'CANCEL_REQUESTED', 'CANCEL_PROCESSING'].includes(h.status)) {
          throw new AppError('VALIDATION_ERROR', { reason: 'booking already cancelled' });
        }
        // Refund the full amount on cancel — mock supplier has no cancel
        // policy or partial refund window. Real-supplier wiring would
        // call HotelBooking's cancellationPolicies and the TBO cancel
        // endpoint to derive the refund amount.
        const refundPaise = h.pricing?.totalSellingPaise ?? 0;
        if (refundPaise > 0) {
          const { walletService } = await import('../services/payment/wallet.service.js');
          const wallet = await walletService.findOrCreateForAgency(
            new Types.ObjectId(req.auth!.tenantId),
            new Types.ObjectId(req.auth!.agencyId),
          );
          await walletService.credit({
            walletId: wallet._id,
            amount: refundPaise,
            type: 'REFUND_CREDIT',
            description: `Hotel cancel ${h.bookingCode ?? String(h._id)} — ${h.hotel?.name ?? 'Hotel'}`,
            performedBy: new Types.ObjectId(req.auth!.userId),
            bookingId: h._id,
            idempotencyKey: `hotel-cancel-${h._id.toHexString()}`,
            metadata: { reason: body.reason ?? 'agent-cancel' },
          });
        }
        h.status = 'CANCELLED';
        h.statusHistory.push({
          status: 'CANCELLED',
          at: new Date(),
          by: new Types.ObjectId(req.auth!.userId),
          note: body.reason?.slice(0, 200) ?? null,
        });
        h.cancelledAt = new Date();
        await h.save();
        return ok(res, serializeHotelBookingAsPublic(h));
      }

      const b = await cancelBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId ?? '',
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        req.params.id,
        body.reason,
      );
      return ok(res, serializeBooking(b));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /bookings/:id/refund — manual admin refund.
 *
 * Outside the auto-refund path (cancel + ticket-failure both already
 * credit the wallet). This endpoint is for goodwill credits, support
 * compensation, post-hoc adjustments, etc. Permission gated to
 * SUPER_ADMIN + ACCOUNTS_USER so agencies can't refund themselves.
 *
 * Amount is capped at the booking's agencyPayablePaise so an over-
 * refund mistake (typing an extra zero) bounces with a clean 400.
 */
bookingRouter.post(
  '/:id/refund',
  requireNotFrozen('booking'),
  requirePermission('booking:refund:manual'),
  validate(ManualRefundRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as ReturnType<typeof ManualRefundRequestSchema.parse>;

      const booking = await Booking.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      });
      if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });
      if (!booking.agencyId) {
        throw new AppError('VALIDATION_ERROR', {
          reason: 'booking has no agency to credit',
        });
      }

      const ceiling = booking.pricing?.agencyPayablePaise ?? 0;
      if (body.amountPaise > ceiling) {
        throw new AppError('VALIDATION_ERROR', {
          reason: `refund (${body.amountPaise} paise) exceeds booking total (${ceiling} paise)`,
        });
      }

      // Credit the agency wallet — admin override, always succeeds
      // even if the wallet is frozen (adjustWallet logs separately).
      const { txnId } = await adjustWallet(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        {
          direction: 'CREDIT',
          amountPaise: body.amountPaise,
          reason: `Manual refund for ${booking.bookingCode}: ${body.reason}`,
          agencyId: String(booking.agencyId),
        },
      );

      // Note the manual refund on the booking row for audit. We use
      // `internalNotes` instead of adding a new field so we don't
      // need a migration for this Phase-4 feature.
      const stamp = new Date().toISOString();
      booking.internalNotes = booking.internalNotes
        ? `${booking.internalNotes}\n[${stamp}] Manual refund ₹${(body.amountPaise / 100).toFixed(2)} — ${body.reason} (txn ${txnId})`
        : `[${stamp}] Manual refund ₹${(body.amountPaise / 100).toFixed(2)} — ${body.reason} (txn ${txnId})`;
      await booking.save();

      return ok(res, {
        bookingId: String(booking._id),
        amountPaise: body.amountPaise,
        walletTxnId: txnId,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /bookings/:id/issue-manually — Phase 5 admin op.
 *
 * Finalize a PENDING_MANUAL booking by attaching the supplier PNR + ticket
 * numbers (+ optional supplier reference) ops obtained out-of-band. Wallet
 * was already debited at confirm time, so this only transitions metadata.
 * Permission-gated to admin-grade roles (`booking:issue-manual`).
 */
bookingRouter.post(
  '/:id/issue-manually',
  requirePermission('booking:issue-manual'),
  validate(IssueManuallyRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as ReturnType<typeof IssueManuallyRequestSchema.parse>;
      const booking = await issueManually(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          // The admin actor doesn't necessarily belong to the agency that
          // owns the booking — tenant scoping inside the service is what
          // matters. Pass empty string so the BookingActor shape stays
          // satisfied; the service doesn't read agencyId here.
          agencyId: req.auth!.agencyId ?? '',
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        req.params.id,
        {
          pnr: body.pnr,
          ticketNumbers: body.ticketNumbers,
          supplierBookingRef: body.supplierBookingRef ?? null,
          note: body.note ?? null,
        },
      );
      return ok(res, serializeBooking(booking));
    } catch (err) {
      next(err);
    }
  },
);

bookingRouter.get('/:id/ticket', requirePermission('booking:download'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const filter = listFilter(req.auth!);
    filter._id = req.params.id;
    const b = await Booking.findOne(filter);
    if (!b) throw new AppError('NOT_FOUND');
    if (b.status !== 'TICKETED') {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'ticket only available for TICKETED bookings',
      });
    }

    // Banner snapshot lifecycle (spec §2.4):
    //   - First download: select a banner, snapshot it onto the booking, render.
    //   - Subsequent downloads: render from snapshot — never re-query, even if
    //     admin paused/edited the banner since.
    let bannerSnapshot = b.ticketTemplate?.bannerSnapshot;
    if (!bannerSnapshot?.bannerId) {
      const picked = await selectBannerForBooking(b);
      if (picked) {
        const snap = bannerSnapshotFromDoc(picked);
        b.ticketTemplate = {
          ...(b.ticketTemplate ?? { templateVersion: 'v1' }),
          bannerSnapshot: snap,
          generatedAt: new Date(),
        };
        await b.save();
        bannerSnapshot = b.ticketTemplate.bannerSnapshot;
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${b.bookingCode}.pdf"`);
    const stream = await generateETicketPdf(b, {
      banner: bannerSnapshot?.bannerId
        ? {
            imageUrl: bannerSnapshot.imageUrl,
            href: bannerSnapshot.href,
            title: bannerSnapshot.title,
          }
        : null,
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Legacy invoice PDF endpoint — kept for backward compat with the
 * existing "Download invoice" button on `bookings/[id]`. Prefers the
 * structured FlightInvoice (model + GST split + sequential number)
 * when present, falls back to the lightweight `generateInvoicePdf()`
 * stub for older bookings that pre-date the FlightInvoice model.
 */
bookingRouter.get('/:id/invoice', requirePermission('booking:download'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const filter = listFilter(req.auth!);
    filter._id = req.params.id;
    const b = await Booking.findOne(filter);
    // Pre-import the branding resolver once — every product branch
    // (hotel / holiday / visa / bus / flight) needs it.
    const { resolveForAgencyOrDistributor, resolveForBooking } = await import(
      '../services/branding/branded-document.service.js'
    );
    if (!b) {
      // Non-flight invoice fallbacks. Hotel first, then holiday — once
      // structured invoice models ship for either, prefer them here.
      const h = await HotelBooking.findOne(filter);
      if (h) {
        const branding = await resolveForAgencyOrDistributor(
          h.tenantId ? String(h.tenantId) : null,
          h.agencyId ? String(h.agencyId) : null,
          null,
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="invoice-${h.bookingCode ?? String(h._id)}.pdf"`,
        );
        generateHotelInvoicePdf(h, branding).pipe(res);
        return;
      }
      const hol = await HolidayBooking.findOne(filter);
      if (hol) {
        const branding = await resolveForAgencyOrDistributor(
          hol.tenantId ? String(hol.tenantId) : null,
          hol.agencyId ? String(hol.agencyId) : null,
          null,
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="invoice-${hol.bookingCode ?? String(hol._id)}.pdf"`,
        );
        generateHolidayInvoicePdf(hol, branding).pipe(res);
        return;
      }
      const visa = await VisaBooking.findOne(filter);
      if (visa) {
        const branding = await resolveForAgencyOrDistributor(
          visa.tenantId ? String(visa.tenantId) : null,
          visa.agencyId ? String(visa.agencyId) : null,
          null,
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="invoice-${visa.bookingCode ?? String(visa._id)}.pdf"`,
        );
        generateVisaInvoicePdf(visa, branding).pipe(res);
        return;
      }
      const bus = await BusBooking.findOne(filter);
      if (bus) {
        // Bus has a structured BusInvoice model and renderer with proper
        // GST splits — prefer that. generateInvoiceForBooking is
        // idempotent (returns the cached row if one exists). Wraps any
        // upstream validation error (booking still BLOCKED, no GST
        // profile, etc) in the same shape so formatApiError surfaces it.
        const { generateInvoiceForBooking } = await import(
          '../services/bus/invoice.service.js'
        );
        const { renderBusInvoicePdf } = await import('../services/bus/invoice-pdf.js');
        const { invoice } = await generateInvoiceForBooking(bus._id);
        const branding = await resolveForAgencyOrDistributor(
          bus.tenantId ? String(bus.tenantId) : null,
          bus.agencyId ? String(bus.agencyId) : null,
          null,
        );
        const pdf = await renderBusInvoicePdf(invoice, branding);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        );
        res.send(pdf);
        return;
      }
      // Insurance "invoice" is the policy PDF — i.e. the certificate of
      // coverage that ASEGO returns. We proxy /insurance/policy/:n/pdf
      // via streamPolicyPdf so the ASEGO file path never leaks to the
      // browser. The same Content-Disposition headers get set inside
      // streamPolicyPdf so we just delegate.
      const policy = await findInsurancePolicyForActor(req.auth!, req.params.id);
      if (policy) {
        const { streamPolicyPdf } = await import(
          '../services/insurance/download.service.js'
        );
        await streamPolicyPdf({ tenantId: req.auth!.tenantId }, policy.policyNumber, res);
        return;
      }
      throw new AppError('NOT_FOUND');
    }

    // Prefer the structured invoice if one exists.
    const inv = await FlightInvoice.findOne({
      tenantId: b.tenantId,
      bookingId: b._id,
    });
    // Resolve the agency / distributor branding so the PDF header
    // carries their logo + colours instead of the TripBng default.
    // Resolver is already imported at the top of this handler.
    const branding = await resolveForBooking(String(b._id));
    if (inv) {
      const pdf = await renderFlightInvoicePdf(inv, branding);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${inv.invoiceNumber}.pdf"`,
      );
      res.send(pdf);
      return;
    }

    // Fallback — old fly-by stub. Renders something usable from the
    // booking's frozen pricing snapshot.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${b.bookingCode}.pdf"`);
    generateInvoicePdf(b, branding).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Structured flight invoice — JSON. Returns 404 when no invoice exists
 * (booking without GST details). Useful for admin tooling that wants
 * to render the invoice inside the app instead of as a PDF download.
 */
bookingRouter.get(
  '/:id/flight-invoice',
  requirePermission('booking:download'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter = listFilter(req.auth!);
      filter._id = req.params.id;
      const b = await Booking.findOne(filter);
      if (!b) throw new AppError('NOT_FOUND');
      const inv = await getInvoiceForFlightBooking(b.tenantId, b._id);
      if (!inv) {
        throw new AppError('NOT_FOUND', {
          reason: 'no invoice for this booking (add GST details on the booking form to receive one)',
        });
      }
      return ok(res, {
        id: String(inv._id),
        invoiceNumber: inv.invoiceNumber,
        bookingId: String(inv.bookingId),
        agencyId: String(inv.agencyId),
        issueDate: inv.issueDate.toISOString(),
        billFrom: inv.billFrom,
        billTo: inv.billTo,
        lines: inv.lines,
        subtotalPaise: inv.subtotalPaise,
        cgstPaise: inv.cgstPaise ?? 0,
        sgstPaise: inv.sgstPaise ?? 0,
        igstPaise: inv.igstPaise ?? 0,
        totalPaise: inv.totalPaise,
        gstSplitKind: inv.gstSplitKind,
        status: inv.status,
        cancelledAt: inv.cancelledAt ? inv.cancelledAt.toISOString() : null,
        createdAt: inv.createdAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Re-trigger invoice generation for a ticketed booking. Idempotent —
 * returns the existing invoice when present. Useful when the original
 * auto-generation hook failed (Redis blip, slow Mongo, etc.).
 */
bookingRouter.post(
  '/:id/flight-invoice/regenerate',
  requirePermission('booking:download'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter = listFilter(req.auth!);
      filter._id = req.params.id;
      const b = await Booking.findOne(filter);
      if (!b) throw new AppError('NOT_FOUND');
      const result = await generateInvoiceForFlightBooking(b._id);
      if (!result) {
        throw new AppError('VALIDATION_ERROR', {
          reason: 'invoice generation skipped — booking missing GST details or not yet ticketed',
        });
      }
      return ok(res, {
        invoiceNumber: result.invoice.invoiceNumber,
        created: result.created,
      });
    } catch (err) {
      next(err);
    }
  },
);
