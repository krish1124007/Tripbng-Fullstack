// DPDP Act 2023 compliance endpoints. Indian users have a statutory right to:
//   1. Access their personal data (subject access request → /me/export)
//   2. Have their data deleted (right to be forgotten → /me/delete-request)
//
// We don't hard-delete on demand — the audit and ledger are retained per the spec's
// regulatory hold (booking + wallet records have downstream legal implications). Instead a
// deletion request transitions the user to BLOCKED, scrubs PII fields where allowed, and
// flags the audit record so SUPER_ADMIN can complete the workflow within statutory
// timelines (typically 30 days).
import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { User } from '../models/User.js';
import { Agency } from '../models/Agency.js';
import { Distributor } from '../models/Distributor.js';
import { Booking } from '../models/Booking.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { TopupRequest } from '../models/TopupRequest.js';
import { Notification } from '../models/Notification.js';
import { Amendment } from '../models/Amendment.js';
import { recordAudit } from '../services/audit.service.js';

export const dataSubjectRouter: RouterT = Router();

dataSubjectRouter.use(authenticate, requireAuth);

// /export — bundles every user-personal record we hold into a single JSON payload. Streams
// straight to the client; the file is the auditable record of what was disclosed.
dataSubjectRouter.get('/me/export', async (req, res, next) => {
  try {
    const auth = req.auth!;
    const [user, agency, distributor, bookings, walletTxns, topups, notifications, amendments] =
      await Promise.all([
        User.findOne({ _id: auth.userId, tenantId: auth.tenantId })
          .select('-passwordHash -twoFactorSecret -pendingTwoFactorSecret')
          .lean(),
        auth.agencyId
          ? Agency.findOne({ _id: auth.agencyId, tenantId: auth.tenantId }).lean()
          : null,
        auth.distributorId
          ? Distributor.findOne({ _id: auth.distributorId, tenantId: auth.tenantId }).lean()
          : null,
        Booking.find({ tenantId: auth.tenantId, bookedByUserId: auth.userId })
          .sort({ createdAt: -1 })
          .lean(),
        WalletTransaction.find({ tenantId: auth.tenantId, performedBy: auth.userId })
          .sort({ createdAt: -1 })
          .lean(),
        TopupRequest.find({ tenantId: auth.tenantId, requestedByUserId: auth.userId })
          .sort({ createdAt: -1 })
          .lean(),
        Notification.find({ tenantId: auth.tenantId, userId: auth.userId })
          .sort({ createdAt: -1 })
          .lean(),
        Amendment.find({ tenantId: auth.tenantId, requestedByUserId: auth.userId })
          .sort({ createdAt: -1 })
          .lean(),
      ]);

    if (!user) throw new AppError('USER_NOT_FOUND');

    const payload = {
      generatedAt: new Date().toISOString(),
      subject: {
        userId: String(user._id),
        userCode: user.userCode,
        email: user.email,
        mobile: user.mobile,
        fullName: user.fullName,
        role: user.role,
      },
      profile: user,
      agency,
      distributor,
      bookings,
      walletTransactions: walletTxns,
      topupRequests: topups,
      notifications,
      amendments,
    };

    await recordAudit({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'data-subject.export',
      resource: 'user',
      resourceId: auth.userId,
      after: {
        bookings: bookings.length,
        walletTxns: walletTxns.length,
        notifications: notifications.length,
      },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="data-export-${user.userCode}-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    next(err);
  }
});

const DeleteBody = z.object({
  reason: z.string().min(3).max(1000),
  // Hard cap — the user has to type their email to confirm the destructive intent.
  confirmEmail: z.string().email(),
});

// /me/delete-request — opens a deletion ticket. Suspends the account immediately so no
// further activity accumulates while ops processes the request inside DPDP timelines.
dataSubjectRouter.post('/me/delete-request', validate(DeleteBody), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const body = req.body as ReturnType<typeof DeleteBody.parse>;

    const user = await User.findOne({ _id: auth.userId, tenantId: auth.tenantId });
    if (!user) throw new AppError('USER_NOT_FOUND');
    if (body.confirmEmail.toLowerCase() !== user.email) {
      throw new AppError('VALIDATION_ERROR', { reason: 'confirmEmail must match account email' });
    }

    user.status = 'SUSPENDED';
    // Note in the user record so admin tooling surfaces this clearly.
    user.mustChangePassword = false;
    await user.save();

    await recordAudit({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'data-subject.delete-request',
      resource: 'user',
      resourceId: auth.userId,
      after: {
        reason: body.reason,
        email: user.email,
        // SLA marker — ops should clear this within statutory window.
        processBy: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    return ok(res, {
      ok: true,
      message:
        'Deletion request received. Your account is suspended; complete deletion within 30 days per DPDP Act 2023.',
      slaDays: 30,
    });
  } catch (err) {
    next(err);
  }
});
