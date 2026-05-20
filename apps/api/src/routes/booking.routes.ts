import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  BookingListQuerySchema,
  CancelBookingRequestSchema,
  ConfirmBookingRequestSchema,
  HoldRequestSchema,
  ManualRefundRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { Booking } from '../models/Booking.js';
import {
  cancelBooking,
  confirmBooking,
  holdBooking,
  serializeBooking,
} from '../services/booking.service.js';
import { generateETicketPdf, generateInvoicePdf } from '../services/booking-pdf.js';
import { bookingAgencyLimit } from '../middleware/agency-rate-limit.js';
import { requireNotFrozen } from '../middleware/cutover-freeze.js';
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
      filter.$or = [
        { bookingCode: new RegExp(q.q, 'i') },
        { pnr: new RegExp(q.q, 'i') },
        { sector: new RegExp(q.q.toUpperCase()) },
      ];
    }
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      filter.travelDate = range;
    }
    const [items, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Booking.countDocuments(filter),
    ]);
    return ok(res, items.map(serializeBooking), {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const filter = listFilter(req.auth!);
    filter._id = req.params.id;
    const b = await Booking.findOne(filter);
    if (!b) throw new AppError('NOT_FOUND');
    return ok(res, serializeBooking(b));
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
    if (!b) throw new AppError('NOT_FOUND');

    // Prefer the structured invoice if one exists.
    const inv = await FlightInvoice.findOne({
      tenantId: b.tenantId,
      bookingId: b._id,
    });
    if (inv) {
      const pdf = await renderFlightInvoicePdf(inv);
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
    generateInvoicePdf(b).pipe(res);
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
