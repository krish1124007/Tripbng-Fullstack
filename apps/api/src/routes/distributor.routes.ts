import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateDistributorRequestSchema,
  PaginationQuerySchema,
  UpdateDistributorRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Distributor } from '../models/Distributor.js';
import { Agency } from '../models/Agency.js';
import {
  createDistributor,
  serializeDistributor,
  updateDistributor,
} from '../services/distributor.service.js';
import { serializeAgency } from '../services/agency.service.js';
import {
  AgencyRegistration,
} from '../models/AgencyRegistration.js';
import {
  ensureDistributorReferralCode,
  resolveDistributorByReferralCode,
  rotateDistributorReferralCode,
} from '../services/registration.service.js';
import { recordAudit } from '../services/audit.service.js';

export const distributorRouter: RouterT = Router();

// ────────── Public referral-code lookup ──────────
//
// Mounted BEFORE the auth gate so the public /register form can resolve
// a referral code as the applicant types it. Returns just the
// distributor's display name + city/state — never the full record.

distributorRouter.get('/public/by-code/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').trim();
    if (!code) throw new AppError('VALIDATION_ERROR', { reason: 'Code required' });
    const d = await resolveDistributorByReferralCode(code);
    if (!d) return ok(res, { found: false });
    return ok(res, {
      found: true,
      distributor: {
        id: String(d._id),
        companyName: d.companyName,
        city: d.city,
        state: d.state,
      },
    });
  } catch (err) {
    next(err);
  }
});

distributorRouter.use(authenticate, requireAuth);

// ────────── Referral-code self-management ──────────
//
// /me/referral-code — for the distributor's own cockpit:
//   GET    → returns the current code (generates one on first read)
//   POST   → rotates to a fresh code (old code stops working)
// /me/referred-agents — list of registrations + provisioned agencies
//   that signed up using this distributor's referral code.

distributorRouter.get('/me/referral-code', async (req, res, next) => {
  try {
    if (req.auth!.role !== 'DISTRIBUTOR' && req.auth!.role !== 'SUPER_ADMIN') {
      throw new AppError('FORBIDDEN');
    }
    const distributorId = req.auth!.distributorId;
    if (!distributorId) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'No distributor account linked to this user.',
      });
    }
    const code = await ensureDistributorReferralCode(distributorId);
    return ok(res, { referralCode: code });
  } catch (err) {
    next(err);
  }
});

distributorRouter.post('/me/referral-code/rotate', async (req, res, next) => {
  try {
    if (req.auth!.role !== 'DISTRIBUTOR' && req.auth!.role !== 'SUPER_ADMIN') {
      throw new AppError('FORBIDDEN');
    }
    const distributorId = req.auth!.distributorId;
    if (!distributorId) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'No distributor account linked to this user.',
      });
    }
    const code = await rotateDistributorReferralCode(distributorId);
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'distributor.referral_code.rotate',
      resource: 'distributor',
      resourceId: distributorId,
      after: { referralCode: code },
    });
    return ok(res, { referralCode: code });
  } catch (err) {
    next(err);
  }
});

distributorRouter.get('/me/referred-agents', async (req, res, next) => {
  try {
    if (req.auth!.role !== 'DISTRIBUTOR' && req.auth!.role !== 'SUPER_ADMIN') {
      throw new AppError('FORBIDDEN');
    }
    const distributorId = req.auth!.distributorId;
    if (!distributorId) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'No distributor account linked to this user.',
      });
    }
    // Registrations attached to this distributor (any status).
    const registrations = await AgencyRegistration.find({
      distributorId: new Types.ObjectId(distributorId),
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .select(
        'applicationCode status companyName ownerFirstName ownerLastName email mobile city state submittedAt createdAt provisionedAgencyId',
      )
      .lean();
    // Already-provisioned agencies under this distributor.
    const liveAgencies = await Agency.find({ distributorId: new Types.ObjectId(distributorId) })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('agencyCode companyName city state status createdAt walletBalance')
      .lean();
    return ok(res, { registrations, agencies: liveAgencies });
  } catch (err) {
    next(err);
  }
});

distributorRouter.get(
  '/',
  requirePermission('distributor:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (q) {
        filter.$or = [{ companyName: new RegExp(q, 'i') }, { distributorCode: new RegExp(q, 'i') }];
      }
      const [items, total] = await Promise.all([
        Distributor.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Distributor.countDocuments(filter),
      ]);
      return ok(res, items.map(serializeDistributor), {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

distributorRouter.get('/:id', requirePermission('distributor:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('DISTRIBUTOR_NOT_FOUND');
    const dist = await Distributor.findOne({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!dist) throw new AppError('DISTRIBUTOR_NOT_FOUND');
    return ok(res, serializeDistributor(dist));
  } catch (err) {
    next(err);
  }
});

distributorRouter.get('/:id/downline', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('DISTRIBUTOR_NOT_FOUND');
    if (req.auth!.role === 'DISTRIBUTOR' && req.auth!.distributorId !== req.params.id) {
      throw new AppError('FORBIDDEN');
    }
    const agencies = await Agency.find({
      tenantId: req.auth!.tenantId,
      distributorId: req.params.id,
    }).sort({ createdAt: -1 });
    return ok(res, agencies.map(serializeAgency));
  } catch (err) {
    next(err);
  }
});

distributorRouter.post(
  '/',
  requirePermission('distributor:create'),
  validate(CreateDistributorRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateDistributorRequestSchema.parse>;
      const { distributor } = await createDistributor(req.auth!.tenantId, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'distributor.create',
        resource: 'distributor',
        resourceId: String(distributor._id),
        after: {
          companyName: distributor.companyName,
          distributorCode: distributor.distributorCode,
        },
      });
      return created(res, serializeDistributor(distributor));
    } catch (err) {
      next(err);
    }
  },
);

distributorRouter.patch(
  '/:id',
  requirePermission('distributor:update'),
  validate(UpdateDistributorRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('DISTRIBUTOR_NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateDistributorRequestSchema.parse>;
      const before = await Distributor.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('DISTRIBUTOR_NOT_FOUND');
      const dist = await updateDistributor(req.params.id, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'distributor.update',
        resource: 'distributor',
        resourceId: req.params.id,
        before: {
          status: before.status,
          overrideCommissionPercent: before.overrideCommissionPercent,
        },
        after: {
          status: dist.status,
          overrideCommissionPercent: dist.overrideCommissionPercent,
        },
      });
      return ok(res, serializeDistributor(dist));
    } catch (err) {
      next(err);
    }
  },
);
