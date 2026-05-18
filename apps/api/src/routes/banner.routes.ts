import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateBannerRequestSchema,
  PaginationQuerySchema,
  UpdateBannerRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { Banner, type BannerDoc } from '../models/Banner.js';
import { recordAudit } from '../services/audit.service.js';

export const bannerRouter: RouterT = Router();
bannerRouter.use(authenticate, requireAuth);

function serialize(b: BannerDoc) {
  return {
    id: String(b._id),
    title: b.title,
    imageUrl: b.imageUrl,
    href: b.href,
    body: b.body,
    type: b.type ?? 'FIXED',
    location: b.location ?? 'AGENCY_DASHBOARD',
    target: b.target ?? 'ALL',
    agencyGroupIds: (b.agencyGroupIds ?? []).map(String),
    distributorIds: (b.distributorIds ?? []).map(String),
    frequency: b.frequency ?? 'PER_SESSION',
    priority: b.priority ?? 100,
    startsAt: b.startsAt ? b.startsAt.toISOString() : null,
    endsAt: b.endsAt ? b.endsAt.toISOString() : null,
    active: b.active ?? true,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// GET /banners — admins see everything; everyone else sees only banners targeted at them.
bannerRouter.get(
  '/',
  requirePermission('banner:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (req.auth!.role !== 'SUPER_ADMIN') {
        const now = new Date();
        filter.active = true;
        filter.$or = [
          { target: 'ALL' },
          ...(req.auth!.role === 'DISTRIBUTOR' && req.auth!.distributorId
            ? [{ target: 'DISTRIBUTOR_DOWNLINE', distributorIds: req.auth!.distributorId }]
            : []),
        ];
        // Use $expr to validate startsAt/endsAt against now since they may both be null.
        filter.$and = [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        ];
      }
      const [items, total] = await Promise.all([
        Banner.find(filter)
          .sort({ priority: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Banner.countDocuments(filter),
      ]);
      return ok(res, items.map(serialize), {
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

bannerRouter.post(
  '/',
  requirePermission('banner:create'),
  validate(CreateBannerRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateBannerRequestSchema.parse>;
      const banner = await Banner.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'banner.create',
        resource: 'banner',
        resourceId: String(banner._id),
        after: { title: banner.title, location: banner.location, active: banner.active },
      });
      return created(res, serialize(banner));
    } catch (err) {
      next(err);
    }
  },
);

bannerRouter.patch(
  '/:id',
  requirePermission('banner:update'),
  validate(UpdateBannerRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateBannerRequestSchema.parse>;
      const updated = await Banner.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

bannerRouter.delete('/:id', requirePermission('banner:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await Banner.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'banner.delete',
      resource: 'banner',
      resourceId: req.params.id,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
