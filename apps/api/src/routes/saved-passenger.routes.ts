// Saved-passenger routes — per-agency directory used by the booking
// form's "Search saved passengers" autofill.
//
// Endpoints:
//   GET    /api/v1/saved-passengers          → list + optional ?q= search
//   POST   /api/v1/saved-passengers          → create
//   PATCH  /api/v1/saved-passengers/:id      → update
//   DELETE /api/v1/saved-passengers/:id      → delete
//
// Scoping:
//   • Every read filters on req.auth!.agencyId — directories are per-
//     agency, not per-user.
//   • Tenant scoping (req.auth!.tenantId) is also applied for defense-
//     in-depth: an agencyId collision across tenants would otherwise
//     leak.
//
// Auth model:
//   • read  → 'saved-passenger:read'  — every booking creator
//   • write → 'saved-passenger:write' — SUB_AGENT+
//
// Idempotency: POST upserts on (agencyId, firstName, lastName, dob).
// Same-name re-saves just refresh the existing record (so the booking
// form can call POST every time the user ticks "Save passenger"
// without worrying about duplicates).

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  SavedPassengerCreateSchema,
  SavedPassengerUpdateSchema,
  type PublicSavedPassenger,
  type SavedPassengerListResponse,
} from '@tripbng/shared';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { SavedPassenger, type SavedPassengerDoc } from '../models/SavedPassenger.js';

export const savedPassengerRouter: RouterT = Router();

// ────────── LIST + SEARCH ──────────
//
// Returns up to 50 saved passengers for the caller's agency, optionally
// filtered by a free-text query that matches firstName / lastName /
// email / phone. The booking form uses this for the autocomplete
// dropdown — keep the response small + cheap.

savedPassengerRouter.get(
  '/',
  requirePermission('saved-passenger:read'),
  async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;

      const filter: Record<string, unknown> = {
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      };
      if (type && ['ADULT', 'CHILD', 'INFANT'].includes(type)) {
        filter.type = type;
      }
      if (q.length > 0) {
        // Case-insensitive prefix match on names + contact fields.
        // Mongo's regex engine will use the (agencyId, firstName) index
        // when the firstName branch matches and falls back to a coll
        // scan for the other branches — fine at directory scale (<10k
        // rows per agency).
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(safe, 'i');
        filter.$or = [
          { firstName: rx },
          { lastName: rx },
          { email: rx },
          { phone: rx },
        ];
      }

      const items = await SavedPassenger.find(filter)
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

      const response: SavedPassengerListResponse = {
        items: items.map((d) => toPublic(d as unknown as SavedPassengerDoc)),
        total: items.length,
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── CREATE / UPSERT ──────────

savedPassengerRouter.post(
  '/',
  requirePermission('saved-passenger:write'),
  validate(SavedPassengerCreateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof SavedPassengerCreateSchema.parse>;

      if (!req.auth?.agencyId) {
        throw new AppError('FORBIDDEN', { reason: 'agency required' });
      }

      // Upsert on the (agencyId, firstName, lastName, dateOfBirth) key.
      // Same-name re-saves refresh the existing row so the booking form
      // can blindly POST without dedup logic on the client.
      const filter: Record<string, unknown> = {
        tenantId: req.auth.tenantId,
        agencyId: req.auth.agencyId,
        firstName: body.firstName,
        lastName: body.lastName,
      };
      if (body.dateOfBirth) {
        filter.dateOfBirth = body.dateOfBirth;
      } else {
        filter.dateOfBirth = null;
      }

      const update = {
        $set: {
          type: body.type,
          title: body.title,
          firstName: body.firstName,
          lastName: body.lastName,
          dateOfBirth: body.dateOfBirth ?? null,
          gender: body.gender ?? null,
          nationality: body.nationality ?? null,
          passport: body.passport ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
        },
        $setOnInsert: {
          tenantId: req.auth.tenantId,
          agencyId: req.auth.agencyId,
          createdBy: req.auth.userId,
        },
      };

      const doc = await SavedPassenger.findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      });

      return ok(res, toPublic(doc!));
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        // Duplicate-key — already exists. Return the existing record
        // so the client can treat the call as idempotent.
        const body = req.body as ReturnType<typeof SavedPassengerCreateSchema.parse>;
        const existing = await SavedPassenger.findOne({
          tenantId: req.auth!.tenantId,
          agencyId: req.auth!.agencyId,
          firstName: body.firstName,
          lastName: body.lastName,
          dateOfBirth: body.dateOfBirth ?? null,
        });
        if (existing) return ok(res, toPublic(existing));
      }
      next(err);
    }
  },
);

// ────────── UPDATE ──────────

savedPassengerRouter.patch(
  '/:id',
  requirePermission('saved-passenger:write'),
  validate(SavedPassengerUpdateSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid id' });
      }
      const body = req.body as ReturnType<typeof SavedPassengerUpdateSchema.parse>;

      const doc = await SavedPassenger.findOne({
        _id: id,
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      });
      if (!doc) throw new AppError('NOT_FOUND', { reason: 'saved-passenger not found' });

      if (body.type !== undefined) doc.type = body.type;
      if (body.title !== undefined) doc.title = body.title;
      if (body.firstName !== undefined) doc.firstName = body.firstName;
      if (body.lastName !== undefined) doc.lastName = body.lastName;
      if (body.dateOfBirth !== undefined) doc.dateOfBirth = body.dateOfBirth;
      if (body.gender !== undefined) doc.gender = body.gender;
      if (body.nationality !== undefined) doc.nationality = body.nationality;
      if (body.passport !== undefined) doc.passport = body.passport ?? null;
      if (body.email !== undefined) doc.email = body.email ?? null;
      if (body.phone !== undefined) doc.phone = body.phone ?? null;

      await doc.save();
      return ok(res, toPublic(doc));
    } catch (err) {
      next(err);
    }
  },
);

// ────────── DELETE ──────────

savedPassengerRouter.delete(
  '/:id',
  requirePermission('saved-passenger:write'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { reason: 'invalid id' });
      }
      const result = await SavedPassenger.deleteOne({
        _id: id,
        tenantId: req.auth!.tenantId,
        agencyId: req.auth!.agencyId,
      });
      if (result.deletedCount === 0) {
        throw new AppError('NOT_FOUND', { reason: 'saved-passenger not found' });
      }
      return ok(res, { id });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Mapper ──────────

function toPublic(d: SavedPassengerDoc): PublicSavedPassenger {
  return {
    id: String(d._id),
    type: d.type as 'ADULT' | 'CHILD' | 'INFANT',
    title: d.title as 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS',
    firstName: d.firstName,
    lastName: d.lastName,
    dateOfBirth: d.dateOfBirth ?? null,
    gender: (d.gender as 'M' | 'F' | null) ?? null,
    nationality: d.nationality ?? null,
    passport: d.passport
      ? {
          number: d.passport.number,
          expiry: d.passport.expiry,
          issuingCountry: d.passport.issuingCountry,
        }
      : null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    createdAt:
      (d.createdAt ?? new Date()).toISOString?.() ?? String(d.createdAt),
    updatedAt:
      (d.updatedAt ?? new Date()).toISOString?.() ?? String(d.updatedAt),
  };
}
