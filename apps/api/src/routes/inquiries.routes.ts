// Partner inquiries — public submission + admin queue.
//
// Public:  POST /api/v1/inquiries (no auth, rate-limited)
// Admin:   GET  /api/v1/inquiries           — paginated list
//          GET  /api/v1/inquiries/:id        — detail
//          PATCH /api/v1/inquiries/:id       — update status / assign / add note
//
// Pattern mirrors providers.routes.ts: per-route role middleware so the
// public POST stays unauthenticated while the rest stays SUPER_ADMIN.

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { PartnerInquiry } from '../models/PartnerInquiry.js';
import { logger } from '../config/logger.js';
import { enqueueAlert } from '../services/alerts/index.js';

export const inquiriesRouter: RouterT = Router();

// ────────── Public submit ──────────

const SubmitSchema = z.object({
  type: z.enum(['AGENCY', 'DISTRIBUTOR']),
  companyName: z.string().min(2).max(120),
  fullName: z.string().min(2).max(80),
  email: z.string().email().max(120),
  mobile: z.string().min(7).max(20),
  city: z.string().max(80).optional().default(''),
  state: z.string().max(80).optional().default(''),
  gstin: z.string().max(20).optional().default(''),
  sizeBand: z.string().max(20).optional().default(''),
  message: z.string().max(2000).optional().default(''),
  /** Honeypot — bots tend to fill every field including invisible ones. */
  website: z.string().optional(),
});

inquiriesRouter.post(
  '/',
  loginLimiter,
  validate(SubmitSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof SubmitSchema.parse>;

      // Drop honeypot hits silently — return the same success response so
      // a bot can't tell its submission was rejected.
      if (body.website && body.website.trim().length > 0) {
        logger.info({ ip: req.ip }, 'inquiry: honeypot triggered, silently discarded');
        return ok(res, { ok: true });
      }

      const doc = await PartnerInquiry.create({
        type: body.type,
        companyName: body.companyName.trim(),
        fullName: body.fullName.trim(),
        email: body.email.trim().toLowerCase(),
        mobile: body.mobile.trim(),
        city: body.city ?? '',
        state: body.state ?? '',
        gstin: (body.gstin ?? '').toUpperCase(),
        sizeBand: body.sizeBand ?? '',
        message: body.message ?? '',
        sourceIp: req.ip ?? null,
        sourceUserAgent: req.header('user-agent') ?? null,
      });

      // Notify ops via email — best-effort. Failure logged but doesn't
      // fail the submission; the inquiry is already in Mongo.
      void notifyOps(doc.toObject(), req.protocol + '://' + req.get('host'));

      return ok(res, { ok: true, id: String(doc._id) });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Admin queue ──────────

const ListQuerySchema = z.object({
  status: z
    .enum(['NEW', 'CONTACTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SPAM'])
    .optional(),
  type: z.enum(['AGENCY', 'DISTRIBUTOR']).optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

inquiriesRouter.get(
  '/',
  authenticate,
  requireAuth,
  requireRole('SUPER_ADMIN'),
  validate(ListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof ListQuerySchema>;
      const filter: Record<string, unknown> = {};
      if (q.status) filter.status = q.status;
      if (q.type) filter.type = q.type;
      if (q.q) {
        const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ companyName: re }, { fullName: re }, { email: re }];
      }
      const skip = (q.page - 1) * q.limit;
      const [rows, total] = await Promise.all([
        PartnerInquiry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(q.limit).lean(),
        PartnerInquiry.countDocuments(filter),
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

inquiriesRouter.get(
  '/:id',
  authenticate,
  requireAuth,
  requireRole('SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { message: 'invalid inquiry id' });
      }
      const row = await PartnerInquiry.findById(id).lean();
      if (!row) throw new AppError('NOT_FOUND', { message: 'inquiry not found' });
      return ok(res, row);
    } catch (err) {
      next(err);
    }
  },
);

const UpdateSchema = z.object({
  status: z
    .enum(['NEW', 'CONTACTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SPAM'])
    .optional(),
  assignedTo: z.string().optional().nullable(),
  note: z.string().max(2000).optional(),
});

inquiriesRouter.patch(
  '/:id',
  authenticate,
  requireAuth,
  requireRole('SUPER_ADMIN'),
  validate(UpdateSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError('VALIDATION_ERROR', { message: 'invalid inquiry id' });
      }
      const patch = req.body as z.infer<typeof UpdateSchema>;
      const doc = await PartnerInquiry.findById(id);
      if (!doc) throw new AppError('NOT_FOUND', { message: 'inquiry not found' });

      if (patch.status) doc.status = patch.status;
      if (patch.assignedTo !== undefined) {
        doc.assignedTo =
          patch.assignedTo && Types.ObjectId.isValid(patch.assignedTo)
            ? (new Types.ObjectId(patch.assignedTo) as unknown as typeof doc.assignedTo)
            : null;
      }
      if (patch.note && patch.note.trim()) {
        doc.notes.push({
          at: new Date(),
          by: req.auth!.userId as unknown as Types.ObjectId,
          note: patch.note.trim(),
        });
      }
      await doc.save();
      return ok(res, doc.toObject());
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Email notification ──────────
//
// Goes through the shared alert system → `{ kind: 'ops' }` recipient resolves
// to OPS_ALERT_EMAIL. The dispatcher handles SMTP failure + retry with BullMQ.
// Tenant is set to 'system' since partner inquiries are pre-tenant (no agency
// exists yet) — the recipient resolver tolerates this for ops-only events.

async function notifyOps(
  doc: ReturnType<InstanceType<typeof PartnerInquiry>['toObject']>,
  appOrigin: string,
): Promise<void> {
  try {
    await enqueueAlert(
      {
        event: 'PARTNER_INQUIRY_RECEIVED',
        vars: {
          inquiryId: String(doc._id),
          type: doc.type as 'AGENCY' | 'DISTRIBUTOR',
          companyName: doc.companyName,
          fullName: doc.fullName,
          email: doc.email,
          mobile: doc.mobile,
          city: doc.city || '',
          state: doc.state || '',
          gstin: doc.gstin || '',
          sizeBand: doc.sizeBand || '',
          message: doc.message || '',
          adminUrl: `${appOrigin}/admin/inquiries/${String(doc._id)}`,
        },
      },
      [{ kind: 'ops' }],
      {
        tenantId: 'system',
        correlationKey: `inquiry:${String(doc._id)}`,
      },
    );
  } catch (err) {
    // Best-effort — alert pipeline has its own retry policy; this catch is
    // just a guard so a Redis blip can't crash the inquiry POST handler.
    logger.warn(
      { err, inquiryId: String(doc._id) },
      'inquiry: enqueueAlert failed (continuing — inquiry already persisted)',
    );
  }
}
