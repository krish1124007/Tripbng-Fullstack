import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreatePolicyRequestSchema,
  PaginationQuerySchema,
  POLICY_COMPONENT_LABEL,
  POLICY_COMPONENTS,
  UpdatePolicyRequestSchema,
  deriveLegacyPricing,
  type PolicyComponentKey,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { containsRegex } from '../utils/regex.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Policy, type PolicyDoc } from '../models/Policy.js';
import { recordAudit } from '../services/audit.service.js';

export const policyRouter: RouterT = Router();

policyRouter.use(authenticate, requireAuth);

type MaybePopulated = { fullName?: string } | Types.ObjectId | null | undefined;
function nameOf(v: MaybePopulated): string | null {
  if (v && typeof v === 'object' && 'fullName' in v && v.fullName) return v.fullName;
  return null;
}

function emptyComponent() {
  return {
    enabled: false,
    name: '',
    valueType: 'PERCENT' as const,
    value: 0,
    morePayout: false,
    extraPayouts: [],
  };
}

function serialize(p: PolicyDoc) {
  const commission = p.commission ?? emptyComponent();
  const plb = p.plb ?? emptyComponent();
  const b2bMarkup = p.b2bMarkup ?? emptyComponent();
  const managementFee = p.managementFee ?? { ...emptyComponent(), hideManagementFee: false };

  const enabledKeys = POLICY_COMPONENTS.filter(
    (k) => (p[k as PolicyComponentKey] as { enabled?: boolean } | undefined)?.enabled,
  );
  const policyType = enabledKeys.map((k) => POLICY_COMPONENT_LABEL[k]).join(', ');
  const morePayout = enabledKeys.some(
    (k) => (p[k as PolicyComponentKey] as { morePayout?: boolean } | undefined)?.morePayout,
  );

  const comp = (c: typeof commission) => ({
    enabled: c.enabled ?? false,
    name: c.name ?? '',
    valueType: (c.valueType ?? 'PERCENT') as 'PERCENT' | 'FLAT',
    value: c.value ?? 0,
    morePayout: c.morePayout ?? false,
    extraPayouts: (c.extraPayouts ?? []).map((r) => ({
      label: r.label ?? '',
      valueType: (r.valueType ?? 'PERCENT') as 'PERCENT' | 'FLAT',
      value: r.value ?? 0,
    })),
  });

  return {
    id: String(p._id),
    productType: p.productType ?? 'AIR',
    name: p.name,
    status: p.status ?? 'ACTIVE',

    commission: comp(commission),
    plb: comp(plb),
    b2bMarkup: comp(b2bMarkup),
    managementFee: { ...comp(managementFee), hideManagementFee: managementFee.hideManagementFee ?? false },

    policyType,
    morePayout,

    notes: p.notes ?? null,

    commissionPercent: p.commissionPercent ?? 0,
    managementFeePaise: p.managementFeePaise ?? 0,
    b2bMarkupPaise: p.b2bMarkupPaise ?? 0,
    gstOnMarkupOnly: p.gstOnMarkupOnly ?? false,
    gstRateBasisPoints: p.gstRateBasisPoints ?? 1800,

    createdBy: nameOf(p.createdBy as MaybePopulated),
    updatedBy: nameOf(p.updatedBy as MaybePopulated),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

policyRouter.get(
  '/',
  requirePermission('policy:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
<<<<<<< HEAD
      if (q) filter.name = new RegExp(q, 'i');
      const productType = req.query.productType as string | undefined;
      const status = req.query.status as string | undefined;
      if (productType) filter.productType = productType.toUpperCase();
      if (status) filter.status = status.toUpperCase();

=======
      {
        const re = containsRegex(q);
        if (re) filter.name = re;
      }
>>>>>>> 566bd27eb66c25e48cac612ba93cd29c96d1ddb7
      const [items, total] = await Promise.all([
        Policy.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('createdBy updatedBy', 'fullName'),
        Policy.countDocuments(filter),
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

policyRouter.get('/:id', requirePermission('policy:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const policy = await Policy.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId }).populate(
      'createdBy updatedBy',
      'fullName',
    );
    if (!policy) throw new AppError('NOT_FOUND');
    return ok(res, serialize(policy));
  } catch (err) {
    next(err);
  }
});

policyRouter.post(
  '/',
  requirePermission('policy:create'),
  validate(CreatePolicyRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreatePolicyRequestSchema.parse>;
      const policy = await Policy.create({
        tenantId: req.auth!.tenantId,
        ...input,
        ...deriveLegacyPricing(input),
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'policy.create',
        resource: 'policy',
        resourceId: String(policy._id),
        after: { name: policy.name, productType: policy.productType },
      });
      return created(res, serialize(policy));
    } catch (err) {
      next(err);
    }
  },
);

policyRouter.patch(
  '/:id',
  requirePermission('policy:update'),
  validate(UpdatePolicyRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdatePolicyRequestSchema.parse>;
      const existing = await Policy.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId });
      if (!existing) throw new AppError('NOT_FOUND');

      // Re-derive legacy pricing from whichever components are present after the merge.
      const merged = {
        commission: input.commission ?? existing.commission,
        b2bMarkup: input.b2bMarkup ?? existing.b2bMarkup,
        managementFee: input.managementFee ?? existing.managementFee,
      };
      const updated = await Policy.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        {
          $set: {
            ...input,
            ...deriveLegacyPricing(merged as Parameters<typeof deriveLegacyPricing>[0]),
            updatedBy: req.auth!.userId,
          },
        },
        { new: true },
      ).populate('createdBy updatedBy', 'fullName');
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'policy.update',
        resource: 'policy',
        resourceId: req.params.id,
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

policyRouter.delete('/:id', requirePermission('policy:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await Policy.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'policy.delete',
      resource: 'policy',
      resourceId: req.params.id,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
