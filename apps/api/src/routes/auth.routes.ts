import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  TwoFactorBootstrapSetupRequestSchema,
  TwoFactorBootstrapVerifyRequestSchema,
  TwoFactorVerifyRequestSchema,
  AppError,
  getDefaultPermissionsForRole,
  type Role,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import {
  loginWithPassword,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/auth.service.js';
import {
  consumePasswordReset,
  requestPasswordReset,
} from '../services/password-reset.service.js';
import { recordAudit } from '../services/audit.service.js';
import { User } from '../models/User.js';
import { signAccessToken } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { buildOtpAuthUrl, buildQrDataUrl, generateTotpSecret, verifyTotp } from '../utils/totp.js';
import { isProd } from '../config/env.js';

export const authRouter: RouterT = Router();

const REFRESH_COOKIE = 'tripbng_refresh';
// `sameSite: 'strict'` — the refresh endpoint is same-origin only (the web
// app + API ship from the same domain in prod, separate processes but the
// browser sees one origin via reverse-proxy). Setting strict here blocks
// cross-site POSTs from carrying the cookie even though they trigger
// preflight — closing the CSRF window the previous `'lax'` left open.
// httpOnly + secure remain the primary protections.
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

authRouter.post('/login', loginLimiter, validate(LoginRequestSchema), async (req, res, next) => {
  try {
    const { email, password, totp } = req.body as ReturnType<typeof LoginRequestSchema.parse>;
    const result = await loginWithPassword(email, password, totp, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    return ok(res, {
      accessToken: result.accessToken,
      user: {
        id: String(result.user._id),
        userCode: result.user.userCode,
        email: result.user.email,
        fullName: result.user.fullName,
        role: result.user.role,
        agencyId: result.user.agencyId ? String(result.user.agencyId) : null,
        distributorId: result.user.distributorId ? String(result.user.distributorId) : null,
        twoFactorEnabled: result.user.twoFactorEnabled,
        permissions: result.permissions,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError('TOKEN_INVALID');
    const next_ = await rotateRefreshToken(token, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    res.cookie(REFRESH_COOKIE, next_.refreshToken, REFRESH_COOKIE_OPTS);
    return ok(res, { accessToken: next_.accessToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (token) await revokeRefreshToken(token);
    res.clearCookie(REFRESH_COOKIE, { ...REFRESH_COOKIE_OPTS, maxAge: 0 });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId);
    if (!user) throw new AppError('USER_NOT_FOUND');
    const defaults = getDefaultPermissionsForRole(user.role as Role);
    const permissions = Array.from(
      new Set([...defaults, ...(user.customPermissions ?? [])]),
    ).filter((p) => !(user.deniedPermissions ?? []).includes(p));
    return ok(res, {
      id: String(user._id),
      userCode: user.userCode,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      agencyId: user.agencyId ? String(user.agencyId) : null,
      distributorId: user.distributorId ? String(user.distributorId) : null,
      twoFactorEnabled: user.twoFactorEnabled,
      preferences: user.preferences,
      permissions,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────── Password reset (forgot / reset) ───────────
//
// Two-step flow: /forgot-password takes an email and emails a single-use
// link; /reset-password consumes the token + sets a new password. We
// reuse the loginLimiter so a probe can't burn through email volume.
//
// Both endpoints intentionally return success even when the email is not
// registered — we don't leak account existence over the public network.

const ForgotPasswordSchema = z.object({
  email: z.string().email().max(120),
});

authRouter.post(
  '/forgot-password',
  loginLimiter,
  validate(ForgotPasswordSchema),
  async (req, res, next) => {
    try {
      const { email } = req.body as ReturnType<typeof ForgotPasswordSchema.parse>;
      await requestPasswordReset(email, {
        ip: req.ip,
        userAgent: req.header('user-agent') ?? undefined,
      });
      // Always the same response shape regardless of email existence.
      return ok(res, {
        ok: true,
        message: 'If the email is registered, a reset link is on its way.',
      });
    } catch (err) {
      next(err);
    }
  },
);

const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(128),
});

authRouter.post(
  '/reset-password',
  loginLimiter,
  validate(ResetPasswordSchema),
  async (req, res, next) => {
    try {
      const { token, password } = req.body as ReturnType<typeof ResetPasswordSchema.parse>;
      const result = await consumePasswordReset({ token, password });
      // Audit log — note we don't have an authenticated actor here, so
      // the actor reference is the affected user (self-service).
      await recordAudit({
        tenantId: result.tenantId,
        actorId: result.userId,
        actorRole: null,
        action: 'auth.reset_password',
        resource: 'user',
        resourceId: result.userId,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/change-password',
  authenticate,
  requireAuth,
  validate(ChangePasswordRequestSchema),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body as ReturnType<
        typeof ChangePasswordRequestSchema.parse
      >;
      const user = await User.findById(req.auth!.userId).select('+passwordHash');
      if (!user) throw new AppError('USER_NOT_FOUND');
      const okPwd = await verifyPassword(currentPassword, user.passwordHash);
      if (!okPwd) throw new AppError('INVALID_CREDENTIALS');
      user.passwordHash = await hashPassword(newPassword);
      user.passwordChangedAt = new Date();
      user.mustChangePassword = false;
      await user.save();
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'auth.change_password',
        resource: 'user',
        resourceId: req.auth!.userId,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post('/2fa/setup', authenticate, requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId).select('+pendingTwoFactorSecret');
    if (!user) throw new AppError('USER_NOT_FOUND');
    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpAuthUrl(user.email, secret);
    const qrDataUrl = await buildQrDataUrl(otpauthUrl);
    user.pendingTwoFactorSecret = secret;
    await user.save();
    return ok(res, { secret, otpauthUrl, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  '/2fa/verify',
  authenticate,
  requireAuth,
  validate(TwoFactorVerifyRequestSchema),
  async (req, res, next) => {
    try {
      const { totp } = req.body as ReturnType<typeof TwoFactorVerifyRequestSchema.parse>;
      const user = await User.findById(req.auth!.userId).select(
        '+pendingTwoFactorSecret +twoFactorSecret',
      );
      if (!user) throw new AppError('USER_NOT_FOUND');
      const candidate = user.pendingTwoFactorSecret ?? user.twoFactorSecret;
      if (!candidate || !verifyTotp(totp, candidate)) throw new AppError('INVALID_TOTP');
      user.twoFactorSecret = candidate;
      user.pendingTwoFactorSecret = null as unknown as string;
      user.twoFactorEnabled = true;
      await user.save();
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'auth.2fa.enable',
        resource: 'user',
        resourceId: req.auth!.userId,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// First-time 2FA enrolment (no session token, password-protected).
//
// Breaks the chicken-and-egg in production where a freshly-seeded SUPER_ADMIN
// can't sign in (2FA gate) and can't reach /2fa/setup (auth gate). The two
// routes below accept email+password instead of a bearer token, and are
// strictly limited to users who haven't enrolled yet — re-enrolment from this
// flow is refused so a stolen password can't rotate a victim's authenticator.
// ─────────────────────────────────────────────────────────────────────────────
authRouter.post(
  '/2fa/bootstrap-setup',
  loginLimiter,
  validate(TwoFactorBootstrapSetupRequestSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body as ReturnType<
        typeof TwoFactorBootstrapSetupRequestSchema.parse
      >;
      const user = await User.findOne({ email }).select(
        '+passwordHash +pendingTwoFactorSecret',
      );
      if (!user) throw new AppError('INVALID_CREDENTIALS');
      if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
      if (user.status === 'BLOCKED') throw new AppError('ACCOUNT_BLOCKED');
      const passwordOk = await verifyPassword(password, user.passwordHash);
      if (!passwordOk) throw new AppError('INVALID_CREDENTIALS');
      if (user.twoFactorEnabled) throw new AppError('TOTP_ALREADY_ENABLED');

      const secret = generateTotpSecret();
      const otpauthUrl = buildOtpAuthUrl(user.email, secret);
      const qrDataUrl = await buildQrDataUrl(otpauthUrl);
      user.pendingTwoFactorSecret = secret;
      await user.save();
      return ok(res, { secret, otpauthUrl, qrDataUrl });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/2fa/bootstrap-verify',
  loginLimiter,
  validate(TwoFactorBootstrapVerifyRequestSchema),
  async (req, res, next) => {
    try {
      const { email, password, totp } = req.body as ReturnType<
        typeof TwoFactorBootstrapVerifyRequestSchema.parse
      >;
      const user = await User.findOne({ email }).select(
        '+passwordHash +pendingTwoFactorSecret +twoFactorSecret',
      );
      if (!user) throw new AppError('INVALID_CREDENTIALS');
      if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
      if (user.status === 'BLOCKED') throw new AppError('ACCOUNT_BLOCKED');
      const passwordOk = await verifyPassword(password, user.passwordHash);
      if (!passwordOk) throw new AppError('INVALID_CREDENTIALS');
      if (user.twoFactorEnabled) throw new AppError('TOTP_ALREADY_ENABLED');
      if (!user.pendingTwoFactorSecret || !verifyTotp(totp, user.pendingTwoFactorSecret)) {
        throw new AppError('INVALID_TOTP');
      }

      user.twoFactorSecret = user.pendingTwoFactorSecret;
      user.pendingTwoFactorSecret = null as unknown as string;
      user.twoFactorEnabled = true;
      await user.save();

      await recordAudit({
        tenantId: String(user.tenantId),
        actorId: String(user._id),
        actorRole: user.role as Role,
        action: 'auth.2fa.bootstrap',
        resource: 'user',
        resourceId: String(user._id),
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const ImpersonateRequestSchema = z.object({
  userId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  reason: z.string().min(3).max(500),
});

authRouter.post(
  '/impersonate',
  authenticate,
  requireAuth,
  validate(ImpersonateRequestSchema),
  async (req, res, next) => {
    try {
      // Hard restrict to SUPER_ADMIN — impersonation is the loudest privileged action we have.
      if (req.auth!.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN');
      const { userId, reason } = req.body as ReturnType<typeof ImpersonateRequestSchema.parse>;
      const target = await User.findOne({ _id: userId, tenantId: req.auth!.tenantId });
      if (!target) throw new AppError('USER_NOT_FOUND');
      if (target.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED');

      // Issue an access token for the target — no refresh token, no cookie.
      // Impersonation is short-lived: when access expires, admin must re-authenticate as themselves.
      const accessToken = signAccessToken({
        sub: String(target._id),
        role: target.role as Role,
        agencyId: target.agencyId ? String(target.agencyId) : null,
        distributorId: target.distributorId ? String(target.distributorId) : null,
      });

      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        impersonatorId: req.auth!.userId,
        action: 'auth.impersonate',
        resource: 'user',
        resourceId: userId,
        after: { reason, targetEmail: target.email, targetRole: target.role },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      return ok(res, {
        accessToken,
        target: {
          id: String(target._id),
          email: target.email,
          fullName: target.fullName,
          role: target.role,
          userCode: target.userCode,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post('/2fa/disable', authenticate, requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId);
    if (!user) throw new AppError('USER_NOT_FOUND');
    user.twoFactorEnabled = false;
    user.twoFactorSecret = null as unknown as string;
    user.pendingTwoFactorSecret = null as unknown as string;
    await user.save();
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'auth.2fa.disable',
      resource: 'user',
      resourceId: req.auth!.userId,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
