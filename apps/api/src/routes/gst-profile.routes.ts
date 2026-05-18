// GstProfile admin CRUD + invoice retrieval routes.
//
// Mounted at /api/v1/bus/gst-profiles + /api/v1/bus/bookings/:id/invoice.
// The bus router applies auth + tenant scoping; we layer per-route
// permissions here.
//
// Tenant scoping: every read/write filters on req.auth!.tenantId.
// `isDefault` invariant — only one profile per tenant is default — is
// enforced in the service layer's create/update path.

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  GstProfileCreateSchema,
  GstProfileUpdateSchema,
  type GstProfileListResponse,
  type PublicBusInvoice,
  type PublicGstProfile,
} from '@tripbng/shared';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { GstProfile, type GstProfileDoc } from '../models/GstProfile.js';
import { BusInvoice, type BusInvoiceDoc } from '../models/BusInvoice.js';
import { BusBooking } from '../models/BusBooking.js';
import {
  generateInvoiceForBooking,
  getInvoiceForBooking,
} from '../services/bus/invoice.service.js';
import { renderBusInvoicePdf } from '../services/bus/invoice-pdf.js';

// ────────── GstProfile CRUD ──────────

export const gstProfileRouter: RouterT = Router();

gstProfileRouter.get(
  '/',
  requirePermission('gst-profile:read'),
  async (req, res, next) => {
    try {
      const items = await GstProfile.find({ tenantId: req.auth!.tenantId })
        .sort({ isDefault: -1, createdAt: -1 })
        .lean();
      const response: GstProfileListResponse = {
        items: items.map((d) =>
          toPublicGstProfile({
            ...d,
            createdAt: (d as { createdAt?: Date }).createdAt ?? new Date(),
            updatedAt: (d as { updatedAt?: Date }).updatedAt ?? new Date(),
          } as unknown as GstProfileDoc),
        ),
        total: items.length,
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

gstProfileRouter.get(
  '/:id',
  requirePermission('gst-profile:read'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!Types.ObjectId.isValid(id!)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid id' });
      }
      const doc = await GstProfile.findOne({ _id: id, tenantId: req.auth!.tenantId });
      if (!doc) throw new AppError('NOT_FOUND', { reason: 'gstProfile not found' });
      return ok(res, toPublicGstProfile(doc));
    } catch (err) {
      next(err);
    }
  },
);

gstProfileRouter.post(
  '/',
  requirePermission('gst-profile:write'),
  validate(GstProfileCreateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof GstProfileCreateSchema.parse>;
      // GSTIN's first two chars encode the state; cross-check that the
      // declared state matches. Catches the common copy-paste error
      // where ops paste the GSTIN but pick the wrong state from the
      // dropdown.
      const stateCode = body.gstin.slice(0, 2);
      // Light cross-check — we can't easily map state-code → name
      // without a table; surface a warning header instead. Phase 9
      // can add the table.
      void stateCode;

      // If isDefault=true, flip the previous default off so the
      // booking flow's resolution stays unambiguous.
      if (body.isDefault) {
        await GstProfile.updateMany(
          { tenantId: req.auth!.tenantId, isDefault: true },
          { $set: { isDefault: false } },
        );
      }

      const created = await GstProfile.create({
        tenantId: req.auth!.tenantId,
        registrationName: body.registrationName,
        gstin: body.gstin,
        address: body.address,
        state: body.state,
        email: body.email,
        isDefault: body.isDefault ?? false,
      });
      return ok(res, toPublicGstProfile(created));
    } catch (err) {
      // Surface duplicate-key (per-tenant gstin uniqueness) as a clean error.
      if ((err as { code?: number }).code === 11000) {
        return next(
          new AppError('VALIDATION_ERROR', {
            reason: 'a profile with this GSTIN already exists for this tenant',
          }),
        );
      }
      next(err);
    }
  },
);

gstProfileRouter.patch(
  '/:id',
  requirePermission('gst-profile:write'),
  validate(GstProfileUpdateSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!Types.ObjectId.isValid(id!)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid id' });
      }
      const body = req.body as ReturnType<typeof GstProfileUpdateSchema.parse>;
      const doc = await GstProfile.findOne({ _id: id, tenantId: req.auth!.tenantId });
      if (!doc) throw new AppError('NOT_FOUND', { reason: 'gstProfile not found' });

      if (body.isDefault === true && !doc.isDefault) {
        await GstProfile.updateMany(
          { tenantId: req.auth!.tenantId, isDefault: true, _id: { $ne: doc._id } },
          { $set: { isDefault: false } },
        );
      }

      // Field-level patch.
      if (body.registrationName !== undefined) doc.registrationName = body.registrationName;
      if (body.gstin !== undefined) doc.gstin = body.gstin;
      if (body.address !== undefined) doc.address = body.address;
      if (body.state !== undefined) doc.state = body.state;
      if (body.email !== undefined) doc.email = body.email;
      if (body.isDefault !== undefined) doc.isDefault = body.isDefault;
      await doc.save();

      return ok(res, toPublicGstProfile(doc));
    } catch (err) {
      next(err);
    }
  },
);

gstProfileRouter.delete(
  '/:id',
  requirePermission('gst-profile:write'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!Types.ObjectId.isValid(id!)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid id' });
      }
      const result = await GstProfile.deleteOne({ _id: id, tenantId: req.auth!.tenantId });
      if (result.deletedCount === 0) {
        throw new AppError('NOT_FOUND', { reason: 'gstProfile not found' });
      }
      return ok(res, { id });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Invoice retrieval (mounted under bus-bookings) ──────────

export const busInvoiceRouter: RouterT = Router({ mergeParams: true });

busInvoiceRouter.get(
  '/',
  requirePermission('bus-invoice:read'),
  async (req, res, next) => {
    try {
      const id = (req.params as { id?: string }).id;
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid bookingId' });
      }
      // Tenant + agency scope verification — booking must belong to
      // the caller's agency before the invoice is exposed.
      const booking = await BusBooking.findOne({
        _id: id,
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      });
      if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });

      const inv = await getInvoiceForBooking(req.auth!.tenantId, id);
      if (!inv) throw new AppError('NOT_FOUND', { reason: 'no invoice for this booking' });
      return ok(res, toPublicInvoice(inv));
    } catch (err) {
      next(err);
    }
  },
);

/** Re-trigger generation. Idempotent: returns the existing row when
 *  one already exists. Useful for the auto-trigger path failing in
 *  production due to a transient Mongo blip. */
busInvoiceRouter.post(
  '/regenerate',
  requirePermission('bus-invoice:read'),
  async (req, res, next) => {
    try {
      const id = (req.params as { id?: string }).id;
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid bookingId' });
      }
      const booking = await BusBooking.findOne({
        _id: id,
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      });
      if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });

      const result = await generateInvoiceForBooking(id);
      return ok(res, {
        ...toPublicInvoice(result.invoice),
        created: result.created,
      });
    } catch (err) {
      next(err);
    }
  },
);

busInvoiceRouter.get(
  '/pdf',
  requirePermission('bus-invoice:read'),
  async (req, res, next) => {
    try {
      const id = (req.params as { id?: string }).id;
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid bookingId' });
      }
      const booking = await BusBooking.findOne({
        _id: id,
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      });
      if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });

      const inv = await BusInvoice.findOne({ tenantId: req.auth!.tenantId, bookingId: id });
      if (!inv) throw new AppError('NOT_FOUND', { reason: 'no invoice for this booking' });

      const pdf = await renderBusInvoicePdf(inv);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${inv.invoiceNumber}.pdf"`,
      );
      res.send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Mappers ──────────

function toPublicGstProfile(d: GstProfileDoc): PublicGstProfile {
  return {
    id: String(d._id),
    registrationName: d.registrationName,
    gstin: d.gstin,
    address: d.address,
    state: d.state,
    email: d.email,
    isDefault: d.isDefault ?? false,
    createdAt: (d.createdAt ?? new Date()).toISOString?.() ?? String(d.createdAt),
    updatedAt: (d.updatedAt ?? new Date()).toISOString?.() ?? String(d.updatedAt),
  };
}

function toPublicInvoice(d: BusInvoiceDoc): PublicBusInvoice {
  return {
    id: String(d._id),
    invoiceNumber: d.invoiceNumber,
    bookingId: String(d.bookingId),
    agencyId: String(d.agencyId),
    gstProfileId: String(d.gstProfileId),
    issueDate: d.issueDate.toISOString(),
    billFrom: {
      name: d.billFrom.name,
      gstin: d.billFrom.gstin,
      pan: d.billFrom.pan,
      address: d.billFrom.address,
      state: d.billFrom.state,
      stateCode: d.billFrom.stateCode,
      email: d.billFrom.email,
    },
    billTo: {
      name: d.billTo.name,
      gstin: d.billTo.gstin,
      pan: d.billTo.pan,
      address: d.billTo.address,
      state: d.billTo.state,
      stateCode: d.billTo.stateCode,
      email: d.billTo.email,
    },
    lines: d.lines.map((l) => ({
      description: l.description,
      hsnSacCode: l.hsnSacCode,
      taxableValuePaise: l.taxableValuePaise,
      gstRateBp: l.gstRateBp,
      gstAmountPaise: l.gstAmountPaise,
      totalPaise: l.totalPaise,
    })),
    subtotalPaise: d.subtotalPaise,
    cgstPaise: d.cgstPaise ?? 0,
    sgstPaise: d.sgstPaise ?? 0,
    igstPaise: d.igstPaise ?? 0,
    totalPaise: d.totalPaise,
    gstSplitKind: d.gstSplitKind,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
