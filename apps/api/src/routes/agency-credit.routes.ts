// Companion route mounted under /agencies/:id/credit-limit. Kept separate from the main
// agency router so the wallet-related concerns stay grouped here.
import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { AppError, SetCreditLimitRequestSchema } from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Agency } from '../models/Agency.js';
import { recordAudit } from '../services/audit.service.js';

export const agencyCreditRouter: RouterT = Router({ mergeParams: true });

agencyCreditRouter.use(authenticate, requireAuth);

agencyCreditRouter.post(
  '/credit-limit',
  requirePermission('wallet:credit-limit:set'),
  validate(SetCreditLimitRequestSchema),
  async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!id || !Types.ObjectId.isValid(id)) throw new AppError('AGENCY_NOT_FOUND');
      const body = req.body as ReturnType<typeof SetCreditLimitRequestSchema.parse>;
      const agency = await Agency.findOne({ _id: id, tenantId: req.auth!.tenantId });
      if (!agency) throw new AppError('AGENCY_NOT_FOUND');
      const before = agency.creditLimit ?? 0;
      agency.creditLimit = body.creditLimitPaise;
      // Toggle the credit payment method based on whether a limit is set.
      if (agency.paymentMethods) {
        agency.paymentMethods.credit = body.creditLimitPaise > 0;
      }
      agency.updatedBy = req.auth!.userId as unknown as typeof agency.updatedBy;
      await agency.save();

      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency.credit-limit.set',
        resource: 'agency',
        resourceId: id,
        before: { creditLimitPaise: before },
        after: { creditLimitPaise: body.creditLimitPaise, reason: body.reason },
      });

      return ok(res, {
        agencyId: id,
        creditLimitPaise: agency.creditLimit ?? 0,
      });
    } catch (err) {
      next(err);
    }
  },
);
