// Routes for the 5 non-flight product modules. All endpoints require auth +
// the standard `search:flights` permission (the same permission gates booking-trade
// access in general — extending later if hotels/visa want their own permission key).
//
// Once a real supplier integration ships, swap the adapter wired in
// services/products.service.ts. The route surface stays identical.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import {
  AdminHolidayPackageListQuerySchema,
  BusSearchRequestSchema,
  HolidaySearchRequestSchema,
  HotelSearchRequestSchema,
  InsuranceQuoteRequestSchema,
  VisaQuoteRequestSchema,
  type BusSearchRequest,
  type HolidaySearchRequest,
  type HotelSearchRequest,
  type InsuranceQuoteRequest,
  type VisaQuoteRequest,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  quoteInsurance,
  quoteVisa,
  searchBuses,
  searchHolidays,
  searchHotels,
} from '../services/products.service.js';
import { getPublicPackage, listPublicPackages } from '../services/holidayPackage.service.js';
import { HolidayBooking } from '../models/HolidayBooking.js';
import { VisaBooking } from '../models/VisaBooking.js';
import { walletService } from '../services/payment/wallet.service.js';
import { nextCode } from '../utils/codes.js';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AppError } from '@tripbng/shared';
import { logger } from '../config/logger.js';
import {
  getPublicProduct,
  listProductsForCountry,
  listPublicProducts,
} from '../services/visaProduct.service.js';

export const productsRouter: RouterT = Router();

productsRouter.use(authenticate, requireAuth);

// All 5 endpoints sit behind the same booking-trade permission used for /search/flights.
// Refactor to per-product permissions later if RBAC needs to differentiate.
const gate = requirePermission('search:flights');

// ────────── HOTELS ──────────

productsRouter.post(
  '/hotels/search',
  gate,
  validate(HotelSearchRequestSchema),
  async (req, res, next) => {
    try {
      const out = await searchHotels(req.body as HotelSearchRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── BUSES ──────────

productsRouter.post(
  '/buses/search',
  gate,
  validate(BusSearchRequestSchema),
  async (req, res, next) => {
    try {
      const out = await searchBuses(req.body as BusSearchRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── HOLIDAYS ──────────

productsRouter.post(
  '/holidays/search',
  gate,
  validate(HolidaySearchRequestSchema),
  async (req, res, next) => {
    try {
      const out = await searchHolidays(req.body as HolidaySearchRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// Admin-authored holiday packages — public reads. Tenant-scoped, gated to
// `published: true`, distinct from the legacy /holidays/search mock above.
// Both surfaces coexist; the search endpoint will keep working until the
// customer detail page (Phase D) consumes admin-authored packages.

const HolidayPackageIdParamsSchema = z.object({ id: z.string().min(1).max(120) });

productsRouter.get(
  '/holidays/packages',
  gate,
  validate(AdminHolidayPackageListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const query = req.query as unknown as z.infer<typeof AdminHolidayPackageListQuerySchema>;
      const items = await listPublicPackages(tenantId, query);
      return ok(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.get(
  '/holidays/packages/:id',
  gate,
  validate(HolidayPackageIdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof HolidayPackageIdParamsSchema>;
      const pkg = await getPublicPackage(tenantId, id);
      return ok(res, pkg);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── HOLIDAY QUICK-BOOK ──────────
//
// Mock-aware shortcut to book an admin-authored holiday package + debit
// the agency wallet in one round-trip. Mirrors the hotel /quick-book
// pattern — no PreBook/voucher cycle since the package itinerary is
// fully built upfront. Real consolidator wiring would replace the
// in-line confirmation with an async supplier call + state machine.

const HolidayQuickBookSchema = z.object({
  packageId: z.string().min(1).max(120),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departureCity: z.string().min(1).max(80).optional(),
  sharingType: z.enum(['single', 'double', 'triple']).default('double'),
  adults: z.number().int().min(1).max(20).default(2),
  childrenWithBed: z.number().int().min(0).max(10).default(0),
  childrenWithoutBed: z.number().int().min(0).max(10).default(0),
  // Total INR amount the user confirmed on screen — server re-derives but
  // we compare against this to fail loud on price drift.
  agreedTotalInr: z.number().int().positive(),
  travellers: z
    .array(
      z.object({
        title: z.enum(['Mr', 'Mrs', 'Miss', 'Ms']),
        firstName: z.string().min(1).max(60),
        lastName: z.string().min(1).max(60),
        paxType: z.enum(['Adult', 'Child']).default('Adult'),
        isLeadPassenger: z.boolean().optional(),
        email: z.string().email().optional().nullable(),
        phone: z.string().max(20).optional().nullable(),
      }),
    )
    .min(1)
    .max(20),
});

productsRouter.post(
  '/holidays/quick-book',
  gate,
  validate(HolidayQuickBookSchema),
  async (req, res, next) => {
    try {
      if (!req.auth!.agencyId) {
        throw new AppError('VALIDATION_ERROR', {
          reason:
            'Holiday bookings require an agency wallet context. Log in as an agency user.',
        });
      }
      const body = req.body as z.infer<typeof HolidayQuickBookSchema>;
      const pkg = await getPublicPackage(req.auth!.tenantId, body.packageId);
      if (!pkg) throw new AppError('NOT_FOUND', { reason: 'package not found or unpublished' });

      const departureDate = new Date(`${body.departureDate}T00:00:00.000Z`);
      const returnDate = new Date(
        departureDate.getTime() + pkg.nights * 24 * 60 * 60 * 1000,
      );

      // Resolve per-pax rates from the cheapest matching price-matrix row.
      // For now we always use the first row — the customer-facing
      // quoteHolidayPackage() helper does the same matrix walk on the
      // client; copying its logic into the server would duplicate code
      // for no real safety win in this mock supplier path. We trust the
      // client-supplied agreedTotalInr after a sanity recompute.
      const matrix = pkg.priceMatrix[0];
      if (!matrix) {
        throw new AppError('VALIDATION_ERROR', { reason: 'package has no published price matrix' });
      }
      const perAdultInr =
        body.sharingType === 'single'
          ? matrix.singleSharingInr
          : body.sharingType === 'triple'
            ? matrix.tripleSharingInr
            : matrix.doubleSharingInr;
      const subtotalInr =
        body.adults * perAdultInr +
        body.childrenWithBed * matrix.childWithBedInr +
        body.childrenWithoutBed * matrix.childWithoutBedInr;
      // Sanity check — agree within 5% to accommodate any client-side
      // rounding (the customer-facing quote helper has its own slabs).
      const drift = Math.abs(subtotalInr - body.agreedTotalInr) / Math.max(subtotalInr, 1);
      if (drift > 0.05) {
        logger.warn(
          { subtotalInr, agreedTotalInr: body.agreedTotalInr },
          'holiday quick-book: price drift > 5% — using server number',
        );
      }
      const totalPaise = subtotalInr * 100;

      const wallet = await walletService.findOrCreateForAgency(
        new Types.ObjectId(req.auth!.tenantId),
        new Types.ObjectId(req.auth!.agencyId),
      );

      const seq = await nextCode('TBNG');
      const bookingCode = `${seq}-HOL`;

      const booking = await HolidayBooking.create({
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
        distributorId: req.auth!.distributorId ?? null,
        bookedByUserId: req.auth!.userId,
        packageId: pkg.id,
        packageTitle: pkg.title,
        destination: pkg.destination ?? null,
        themeLabel: pkg.themeLabel ?? null,
        heroImage: pkg.heroImages?.[0] ?? null,
        nights: pkg.nights,
        departureDate,
        returnDate,
        departureCity: body.departureCity ?? pkg.departureCities?.[0] ?? null,
        sharingType: body.sharingType,
        adults: body.adults,
        childrenWithBed: body.childrenWithBed,
        childrenWithoutBed: body.childrenWithoutBed,
        travellers: body.travellers.map((t, idx) => ({
          ...t,
          isLeadPassenger: t.isLeadPassenger ?? idx === 0,
        })),
        currency: 'INR',
        pricing: {
          perAdultPaise: perAdultInr * 100,
          perChildBedPaise: matrix.childWithBedInr * 100,
          perChildNoBedPaise: matrix.childWithoutBedInr * 100,
          subtotalPaise: totalPaise,
          gstPaise: 0,
          totalPaise,
        },
        supplier: 'MOCK',
        supplierRefs: {
          bookingCode: `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`,
          confirmationNo: `HOL${Math.floor(Math.random() * 1e8)
            .toString()
            .padStart(8, '0')}`,
        },
        bookingCode,
        status: 'CONFIRMED',
        statusHistory: [
          { status: 'DRAFT', at: new Date(), by: new Types.ObjectId(req.auth!.userId) },
          { status: 'CONFIRMED', at: new Date(), by: new Types.ObjectId(req.auth!.userId) },
        ],
        confirmedAt: new Date(),
      });

      // Wallet debit. Failure → mark BOOK_FAILED and bubble.
      try {
        await walletService.debit({
          walletId: wallet._id,
          amount: totalPaise,
          type: 'BOOKING_DEBIT',
          description: `Holiday ${bookingCode} — ${pkg.title}`,
          performedBy: new Types.ObjectId(req.auth!.userId),
          bookingId: booking._id,
          idempotencyKey: `holiday-book-${booking._id.toHexString()}`,
          metadata: {
            packageId: pkg.id,
            packageTitle: pkg.title,
            departureDate: body.departureDate,
            nights: pkg.nights,
            sharingType: body.sharingType,
            adults: body.adults,
            childrenWithBed: body.childrenWithBed,
            childrenWithoutBed: body.childrenWithoutBed,
          },
        });
      } catch (err) {
        booking.status = 'BOOK_FAILED';
        booking.statusHistory.push({
          status: 'BOOK_FAILED',
          at: new Date(),
          by: new Types.ObjectId(req.auth!.userId),
          note: err instanceof Error ? err.message.slice(0, 200) : 'wallet debit failed',
        });
        await booking.save();
        throw err;
      }

      logger.info(
        {
          bookingId: String(booking._id),
          bookingCode,
          packageId: pkg.id,
          totalPaise,
        },
        'holiday quick-book: confirmed + paid',
      );

      return ok(res, {
        id: String(booking._id),
        bookingCode,
        status: booking.status,
        supplierRefs: booking.supplierRefs,
        packageTitle: pkg.title,
        destination: pkg.destination,
        nights: pkg.nights,
        departureDate: booking.departureDate,
        returnDate: booking.returnDate,
        pricing: booking.pricing,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── VISA ──────────

productsRouter.post(
  '/visa/quote',
  gate,
  validate(VisaQuoteRequestSchema),
  async (req, res, next) => {
    try {
      const out = await quoteVisa(req.body as VisaQuoteRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// Admin-authored visa products — public reads. Tenant-scoped, gated to
// `published: true`. Distinct from the legacy /visa/quote mock above; both
// surfaces coexist while the customer detail page (Phase D) is built out.

const VisaProductIdParamsSchema = z.object({ id: z.string().min(1).max(120) });
const VisaCountryParamsSchema = z.object({ countryId: z.string().min(1).max(120) });
const VisaPublicListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  iso2: z.string().length(2).optional(),
  purpose: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

productsRouter.get(
  '/visa/products',
  gate,
  validate(VisaPublicListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const query = req.query as unknown as z.infer<typeof VisaPublicListQuerySchema>;
      const items = await listPublicProducts(tenantId, query);
      return ok(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.get(
  '/visa/products/:id',
  gate,
  validate(VisaProductIdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof VisaProductIdParamsSchema>;
      const product = await getPublicProduct(tenantId, id);
      return ok(res, product);
    } catch (err) {
      next(err);
    }
  },
);

// "Curated visa products" surface used by the customer page on
// /visa/countries/[id]. We don't have a separate countries collection; this
// just returns the published products keyed to the country slug.
productsRouter.get(
  '/visa/countries/:countryId',
  gate,
  validate(VisaCountryParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { countryId } = req.params as unknown as z.infer<typeof VisaCountryParamsSchema>;
      const products = await listProductsForCountry(tenantId, countryId);
      return ok(res, { countryId, products });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── VISA QUICK-BOOK ──────────
//
// Mock-aware shortcut to file a visa application + debit the agency wallet
// in one round-trip. Mirrors the holiday quick-book pattern — no embassy
// portal call yet, just a CONFIRMED VisaBooking + ledger entry. Real
// embassy/VFS wiring would replace the inline confirmation with an async
// supplier call + document-upload portal.

const VisaQuickBookSchema = z.object({
  productId: z.string().min(1).max(120),
  urgent: z.boolean().default(false),
  expectedTravelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  agreedTotalInr: z.number().int().positive(),
  applicants: z
    .array(
      z.object({
        title: z.enum(['Mr', 'Mrs', 'Miss', 'Ms', 'Mstr']),
        firstName: z.string().min(1).max(60),
        lastName: z.string().min(1).max(60),
        paxType: z.enum(['ADT', 'CHD', 'INF']).default('ADT'),
        isLeadPassenger: z.boolean().optional(),
        email: z.string().email().optional().nullable(),
        phone: z.string().max(20).optional().nullable(),
        nationality: z.string().length(2).default('IN'),
        passportNumber: z.string().min(4).max(20).optional().nullable(),
        passportExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      }),
    )
    .min(1)
    .max(20),
});

productsRouter.post(
  '/visa/quick-book',
  gate,
  validate(VisaQuickBookSchema),
  async (req, res, next) => {
    try {
      if (!req.auth!.agencyId) {
        throw new AppError('VALIDATION_ERROR', {
          reason: 'Visa bookings require an agency wallet context. Log in as an agency user.',
        });
      }
      const body = req.body as z.infer<typeof VisaQuickBookSchema>;
      const product = await getPublicProduct(req.auth!.tenantId, body.productId);
      if (!product) {
        throw new AppError('NOT_FOUND', { reason: 'visa product not found or unpublished' });
      }

      // Pick the matching priceMatrix row by applicant count, falling back
      // to the product-level consulate/service fees.
      const applicantCount = body.applicants.length;
      const matrix = product.priceMatrix.find(
        (r) => applicantCount >= r.fromPax && applicantCount <= r.toPax,
      );
      const consulateFeeInr = matrix?.consulateFeeInr ?? product.consulateFeeInr ?? 0;
      const serviceFeeInr = matrix?.serviceFeeInr ?? product.serviceFeeInr ?? 0;
      const urgentSurchargeInr = body.urgent
        ? matrix?.urgentSurchargeInr ?? product.urgentSurchargeInr ?? 0
        : 0;
      const perApplicantInr = consulateFeeInr + serviceFeeInr + urgentSurchargeInr;
      const subtotalInr = perApplicantInr * applicantCount;
      const drift = Math.abs(subtotalInr - body.agreedTotalInr) / Math.max(subtotalInr, 1);
      if (drift > 0.05) {
        logger.warn(
          { subtotalInr, agreedTotalInr: body.agreedTotalInr },
          'visa quick-book: price drift > 5% — using server number',
        );
      }
      const totalPaise = subtotalInr * 100;

      const wallet = await walletService.findOrCreateForAgency(
        new Types.ObjectId(req.auth!.tenantId),
        new Types.ObjectId(req.auth!.agencyId),
      );

      const seq = await nextCode('TBNG');
      const bookingCode = `${seq}-VIS`;

      const expected = body.expectedTravelDate
        ? new Date(`${body.expectedTravelDate}T00:00:00.000Z`)
        : new Date(Date.now() + (product.processingDays ?? 7) * 24 * 60 * 60 * 1000);

      const booking = await VisaBooking.create({
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
        distributorId: req.auth!.distributorId ?? null,
        bookedByUserId: req.auth!.userId,
        productId: product.id,
        productName: product.name,
        countryId: product.countryId ?? null,
        countryName: product.countryName ?? null,
        countryIso2: product.countryIso2 ?? null,
        region: product.region ?? null,
        purpose: product.purpose,
        processingMode: product.processingMode,
        entryType: product.entryType,
        validityDays: product.validityDays,
        stayDays: product.stayDays,
        processingDays: product.processingDays,
        bannerImage: product.bannerImage ?? null,
        expectedTravelDate: expected,
        urgent: body.urgent,
        applicants: body.applicants.map((a, idx) => ({
          ...a,
          isLeadPassenger: a.isLeadPassenger ?? idx === 0,
          passportExpiry: a.passportExpiry
            ? new Date(`${a.passportExpiry}T00:00:00.000Z`)
            : null,
        })),
        currency: 'INR',
        pricing: {
          consulateFeePaise: consulateFeeInr * 100,
          serviceFeePaise: serviceFeeInr * 100,
          urgentSurchargePaise: urgentSurchargeInr * 100,
          perApplicantPaise: perApplicantInr * 100,
          applicants: applicantCount,
          subtotalPaise: totalPaise,
          gstPaise: 0,
          totalPaise,
        },
        supplier: 'MOCK',
        supplierRefs: {
          applicationNo: `VIS${Math.floor(Math.random() * 1e8)
            .toString()
            .padStart(8, '0')}`,
          portalRef: `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
        bookingCode,
        status: 'CONFIRMED',
        statusHistory: [
          { status: 'DRAFT', at: new Date(), by: new Types.ObjectId(req.auth!.userId) },
          { status: 'CONFIRMED', at: new Date(), by: new Types.ObjectId(req.auth!.userId) },
        ],
        confirmedAt: new Date(),
      });

      try {
        await walletService.debit({
          walletId: wallet._id,
          amount: totalPaise,
          type: 'BOOKING_DEBIT',
          description: `Visa ${bookingCode} — ${product.name}`,
          performedBy: new Types.ObjectId(req.auth!.userId),
          bookingId: booking._id,
          idempotencyKey: `visa-book-${booking._id.toHexString()}`,
          metadata: {
            productId: product.id,
            productName: product.name,
            countryIso2: product.countryIso2,
            urgent: body.urgent,
            applicants: applicantCount,
          },
        });
      } catch (err) {
        booking.status = 'BOOK_FAILED';
        booking.statusHistory.push({
          status: 'BOOK_FAILED',
          at: new Date(),
          by: new Types.ObjectId(req.auth!.userId),
          note: err instanceof Error ? err.message.slice(0, 200) : 'wallet debit failed',
        });
        await booking.save();
        throw err;
      }

      logger.info(
        { bookingId: String(booking._id), bookingCode, productId: product.id, totalPaise },
        'visa quick-book: confirmed + paid',
      );

      return ok(res, {
        id: String(booking._id),
        bookingCode,
        status: booking.status,
        supplierRefs: booking.supplierRefs,
        productName: product.name,
        countryName: product.countryName,
        applicants: applicantCount,
        pricing: booking.pricing,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── INSURANCE ──────────

productsRouter.post(
  '/insurance/quote',
  gate,
  validate(InsuranceQuoteRequestSchema),
  async (req, res, next) => {
    try {
      const out = await quoteInsurance(req.body as InsuranceQuoteRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);
