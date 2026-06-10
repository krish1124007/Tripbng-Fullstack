// Admin-side registration queue.
//
// Mounted at /api/v1/admin/registrations. SUPER_ADMIN-only — these
// routes provision real Agency + User accounts on approval and email
// out temp passwords; they aren't surfaces a normal user should ever
// touch.
//
// Routes:
//   GET    /                — paginated queue with filters
//   GET    /:id             — single registration with all fields
//   POST   /:id/approve     — provisions Agency + User, emails creds
//   POST   /:id/reject      — sets REJECTED with reason, emails note
//   POST   /:id/note        — admin-only internal note (audit trail)
//   POST   /:id/needs-info  — flips status so applicant can edit again

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  AgencyRegistration,
  REGISTRATION_STATUS,
} from '../models/AgencyRegistration.js';
import {
  approveRegistration,
  rejectRegistration,
  resendWelcomeEmail,
} from '../services/registration.service.js';
import { recordAudit } from '../services/audit.service.js';

export const adminRegistrationsRouter: RouterT = Router();

adminRegistrationsRouter.use(authenticate, requireAuth, requireRole('SUPER_ADMIN'));

const ListQuerySchema = z.object({
  status: z.enum(REGISTRATION_STATUS).optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminRegistrationsRouter.get(
  '/',
  validate(ListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof ListQuerySchema>;
      const filter: Record<string, unknown> = {};
      if (q.status) filter.status = q.status;
      if (q.q) {
        const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [
          { companyName: re },
          { ownerFirstName: re },
          { ownerLastName: re },
          { email: re },
          { mobile: re },
          { applicationCode: re.source.toUpperCase() },
        ];
      }
      const skip = (q.page - 1) * q.limit;
      const [rows, total] = await Promise.all([
        AgencyRegistration.find(filter)
          .sort({ submittedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(q.limit)
          .select(
            'applicationCode status agentType companyName companyType email mobile mobileVerified emailVerified panVerified aadharVerified gstVerified city state distributorCode distributorId submittedAt createdAt',
          )
          .lean(),
        AgencyRegistration.countDocuments(filter),
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

adminRegistrationsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const doc = await AgencyRegistration.findById(id).lean();
    if (!doc) throw new AppError('NOT_FOUND');
    return ok(res, doc);
  } catch (err) {
    next(err);
  }
});

/** Resend the welcome email for an already-approved registration. Used when
 *  the original send failed (SMTP outage, applicant email typo since fixed,
 *  applicant deleted the original by accident, etc.). Does NOT re-mint the
 *  temp password — see resendWelcomeEmail() doc for the rationale. */
adminRegistrationsRouter.post('/:id/resend-welcome', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const result = await resendWelcomeEmail({
      registrationId: id,
      triggeredByUserId: req.auth!.userId,
    });
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'registration.resend-welcome',
      resource: 'agencyRegistration',
      resourceId: id,
      after: { resent: result.resent, reason: result.reason ?? null },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    if (!result.resent) {
      throw new AppError('SUPPLIER_UNAVAILABLE', {
        reason: result.reason ?? 'Resend failed',
      });
    }
    return ok(res, { resent: true });
  } catch (err) {
    next(err);
  }
});

adminRegistrationsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const result = await approveRegistration({
      registrationId: id,
      reviewerUserId: req.auth!.userId,
      tenantId: req.auth!.tenantId,
    });
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'registration.approve',
      resource: 'agencyRegistration',
      resourceId: id,
      after: { agencyId: result.agencyId, userId: result.userId },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    return ok(res, {
      agencyId: result.agencyId,
      userId: result.userId,
      // Surface the temp password to the admin so they can read it to
      // the applicant on the phone if email delivery flakes. Email
      // also goes out automatically.
      tempPassword: result.tempPassword,
    });
  } catch (err) {
    next(err);
  }
});

const RejectSchema = z.object({
  reason: z.string().min(2).max(2000),
});

adminRegistrationsRouter.post(
  '/:id/reject',
  validate(RejectSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const { reason } = req.body as z.infer<typeof RejectSchema>;
      await rejectRegistration({
        registrationId: id,
        reviewerUserId: req.auth!.userId,
        reason,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'registration.reject',
        resource: 'agencyRegistration',
        resourceId: id,
        after: { reason },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const NoteSchema = z.object({
  note: z.string().min(1).max(2000),
});

adminRegistrationsRouter.post(
  '/:id/note',
  validate(NoteSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const { note } = req.body as z.infer<typeof NoteSchema>;
      const doc = await AgencyRegistration.findById(id);
      if (!doc) throw new AppError('NOT_FOUND');
      doc.reviewNotes.push({
        at: new Date(),
        by: req.auth!.userId as unknown as Types.ObjectId,
        note,
      });
      // Touching the registration without changing status counts as
      // entering review.
      if (doc.status === 'SUBMITTED') doc.status = 'UNDER_REVIEW';
      await doc.save();
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const NeedsInfoSchema = z.object({
  reason: z.string().min(2).max(2000),
});

adminRegistrationsRouter.post(
  '/:id/needs-info',
  validate(NeedsInfoSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const { reason } = req.body as z.infer<typeof NeedsInfoSchema>;
      const doc = await AgencyRegistration.findById(id);
      if (!doc) throw new AppError('NOT_FOUND');
      if (doc.status === 'APPROVED' || doc.status === 'REJECTED') {
        throw new AppError('VALIDATION_ERROR', {
          reason: `Cannot reopen from status=${doc.status}`,
        });
      }
      doc.status = 'NEEDS_INFO';
      doc.rejectionReason = reason;
      doc.reviewerUserId = req.auth!.userId as unknown as typeof doc.reviewerUserId;
      doc.reviewedAt = new Date();
      await doc.save();
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);
