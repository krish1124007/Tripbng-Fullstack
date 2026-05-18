import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AmendmentListQuerySchema,
  ApproveAmendmentRequestSchema,
  AppError,
  CreateAmendmentRequestSchema,
} from '@tripbng/shared';
import { z } from 'zod';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { Amendment } from '../models/Amendment.js';
import {
  approveAmendment,
  createAmendment,
  rejectAmendment,
  serializeAmendment,
} from '../services/amendment.service.js';

export const amendmentRouter: RouterT = Router();
amendmentRouter.use(authenticate, requireAuth);

amendmentRouter.post(
  '/',
  requirePermission('amendment:create'),
  validate(CreateAmendmentRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateAmendmentRequestSchema.parse>;
      const a = await createAmendment(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId ?? '',
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        input,
      );
      return created(res, serializeAmendment(a));
    } catch (err) {
      next(err);
    }
  },
);

amendmentRouter.get('/', validate(AmendmentListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as ReturnType<typeof AmendmentListQuerySchema.parse>;
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
    if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
      filter.agencyId = req.auth!.agencyId;
    } else if (req.auth!.role === 'DISTRIBUTOR') {
      filter.distributorId = req.auth!.distributorId;
    }
    if (q.status) filter.status = q.status;
    if (q.type) filter.type = q.type;
    const [items, total] = await Promise.all([
      Amendment.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Amendment.countDocuments(filter),
    ]);
    return ok(res, items.map(serializeAmendment), {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  } catch (err) {
    next(err);
  }
});

amendmentRouter.post(
  '/:id/approve',
  requirePermission('amendment:approve'),
  validate(ApproveAmendmentRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as ReturnType<typeof ApproveAmendmentRequestSchema.parse>;
      const a = await approveAmendment(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId ?? '',
          distributorId: req.auth!.distributorId,
          ipAddress: req.ip ?? null,
        },
        req.params.id,
        body,
      );
      return ok(res, serializeAmendment(a));
    } catch (err) {
      next(err);
    }
  },
);

const RejectBody = z.object({ reason: z.string().min(3).max(500) });
amendmentRouter.post(
  '/:id/reject',
  requirePermission('amendment:reject'),
  validate(RejectBody),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as { reason: string };
      const a = await rejectAmendment(
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
      return ok(res, serializeAmendment(a));
    } catch (err) {
      next(err);
    }
  },
);
