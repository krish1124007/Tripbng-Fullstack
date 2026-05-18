import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { AppError, NotificationListQuerySchema } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { Notification } from '../models/Notification.js';
import { serializeNotification } from '../services/notification.service.js';

export const notificationRouter: RouterT = Router();

notificationRouter.use(authenticate, requireAuth);

notificationRouter.get(
  '/',
  requirePermission('notification:read:own'),
  validate(NotificationListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof NotificationListQuerySchema.parse>;
      const filter: Record<string, unknown> = {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
      };
      if (q.unreadOnly) filter.read = false;
      if (q.category) filter.category = q.category;

      const [items, total, unread] = await Promise.all([
        Notification.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit),
        Notification.countDocuments(filter),
        Notification.countDocuments({
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          read: false,
        }),
      ]);
      return ok(
        res,
        items.map(serializeNotification),
        { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
        // unread count is not part of pagination meta; piggy-back via header.
      );
      void unread;
    } catch (err) {
      next(err);
    }
  },
);

notificationRouter.get('/unread-count', async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      read: false,
    });
    return ok(res, { count });
  } catch (err) {
    next(err);
  }
});

notificationRouter.post('/:id/read', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId, userId: req.auth!.userId },
      { $set: { read: true, readAt: new Date() } },
      { new: true },
    );
    if (!updated) throw new AppError('NOT_FOUND');
    return ok(res, serializeNotification(updated));
  } catch (err) {
    next(err);
  }
});

notificationRouter.post('/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { tenantId: req.auth!.tenantId, userId: req.auth!.userId, read: false },
      { $set: { read: true, readAt: new Date() } },
    );
    return ok(res, { matched: result.matchedCount, modified: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});
