import crypto from 'node:crypto';
import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  CreateUserRequestSchema,
  PaginationQuerySchema,
  UpdateUserRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { User } from '../models/User.js';
import { createUser, serializeUser, updateUser } from '../services/user.service.js';
import { recordAudit } from '../services/audit.service.js';
import { hashPassword } from '../utils/password.js';

export const userRouter: RouterT = Router();

userRouter.use(authenticate, requireAuth);

userRouter.get(
  '/',
  requirePermission('user:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (req.auth!.role === 'DISTRIBUTOR') filter.distributorId = req.auth!.distributorId;
      if (req.auth!.role === 'AGENCY') filter.agencyId = req.auth!.agencyId;
      if (q) {
        filter.$or = [
          { email: new RegExp(q, 'i') },
          { fullName: new RegExp(q, 'i') },
          { userCode: new RegExp(q, 'i') },
        ];
      }
      const [items, total] = await Promise.all([
        User.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        User.countDocuments(filter),
      ]);
      return ok(res, items.map(serializeUser), {
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

userRouter.get('/:id', requirePermission('user:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('USER_NOT_FOUND');
    const user = await User.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId });
    if (!user) throw new AppError('USER_NOT_FOUND');
    return ok(res, serializeUser(user));
  } catch (err) {
    next(err);
  }
});

userRouter.post(
  '/',
  requirePermission('user:create'),
  validate(CreateUserRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateUserRequestSchema.parse>;
      const user = await createUser(req.auth!.tenantId, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'user.create',
        resource: 'user',
        resourceId: String(user._id),
        after: { email: user.email, role: user.role },
      });
      return created(res, serializeUser(user));
    } catch (err) {
      next(err);
    }
  },
);

userRouter.patch(
  '/:id',
  requirePermission('user:update'),
  validate(UpdateUserRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('USER_NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateUserRequestSchema.parse>;
      const before = await User.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('USER_NOT_FOUND');
      const user = await updateUser(req.params.id, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'user.update',
        resource: 'user',
        resourceId: req.params.id,
        before: { status: before.status, fullName: before.fullName },
        after: { status: user.status, fullName: user.fullName },
      });
      return ok(res, serializeUser(user));
    } catch (err) {
      next(err);
    }
  },
);

async function changeStatus(
  userId: string,
  tenantId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  actor: { id: string; role: string },
  reason?: string,
) {
  if (!Types.ObjectId.isValid(userId)) throw new AppError('USER_NOT_FOUND');
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) throw new AppError('USER_NOT_FOUND');
  const before = user.status;
  user.status = status;
  user.updatedBy = actor.id as unknown as typeof user.updatedBy;
  await user.save();
  await recordAudit({
    tenantId,
    actorId: actor.id,
    actorRole: actor.role,
    action: status === 'ACTIVE' ? 'user.activate' : 'user.suspend',
    resource: 'user',
    resourceId: userId,
    before: { status: before },
    after: { status, reason: reason ?? null },
  });
  return user;
}

userRouter.post('/:id/suspend', requirePermission('user:suspend'), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const user = await changeStatus(
      req.params.id,
      req.auth!.tenantId,
      'SUSPENDED',
      { id: req.auth!.userId, role: req.auth!.role },
      reason,
    );
    return ok(res, serializeUser(user));
  } catch (err) {
    next(err);
  }
});

userRouter.post('/:id/activate', requirePermission('user:activate'), async (req, res, next) => {
  try {
    const user = await changeStatus(req.params.id, req.auth!.tenantId, 'ACTIVE', {
      id: req.auth!.userId,
      role: req.auth!.role,
    });
    return ok(res, serializeUser(user));
  } catch (err) {
    next(err);
  }
});

const ResetPasswordRequestBody = z.object({
  // Optional — if omitted, generate a random temp password and return it once.
  newPassword: z.string().min(10).optional(),
  mustChangeOnLogin: z.boolean().default(true),
});

userRouter.post(
  '/:id/reset-password',
  requirePermission('user:reset-password'),
  validate(ResetPasswordRequestBody),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('USER_NOT_FOUND');
      const body = req.body as ReturnType<typeof ResetPasswordRequestBody.parse>;
      const user = await User.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId });
      if (!user) throw new AppError('USER_NOT_FOUND');

      const tempPassword = body.newPassword ?? `${crypto.randomBytes(6).toString('base64url')}A1!`;
      user.passwordHash = await hashPassword(tempPassword);
      user.passwordChangedAt = new Date();
      user.mustChangePassword = body.mustChangeOnLogin;
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await user.save();

      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'user.reset_password',
        resource: 'user',
        resourceId: req.params.id,
        after: { mustChangeOnLogin: body.mustChangeOnLogin },
      });

      // Return the temp password only when admin didn't supply one — they can deliver it OOB.
      return ok(res, body.newPassword ? { ok: true } : { ok: true, tempPassword });
    } catch (err) {
      next(err);
    }
  },
);
