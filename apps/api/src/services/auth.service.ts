import crypto from 'node:crypto';
import ms from 'ms';
import { AppError, getDefaultPermissionsForRole, type Role } from '@tripbng/shared';
import { env } from '../config/env.js';
import { User, type UserDoc } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { verifyPassword } from '../utils/password.js';
import { verifyTotp } from '../utils/totp.js';
import { enqueueAlert } from './alerts/index.js';
import { recordAudit } from './audit.service.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface LoginContext {
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export interface LoginResult {
  user: UserDoc;
  accessToken: string;
  refreshToken: string;
  permissions: string[];
}

// Audit-log helper for login failures. Fire-and-forget; recordAudit already
// swallows its own errors so a write failure can't poison auth. `actorId`
// is the user._id when known (bad-password / locked / TOTP failures) and
// null when the email didn't match any account — distinguishing
// "wrong-email" from "right-email-wrong-everything-else" is what makes the
// log forensically useful.
async function auditLoginFailure(
  email: string,
  reason: string,
  user: UserDoc | null,
  ctx: LoginContext,
): Promise<void> {
  await recordAudit({
    tenantId: user?.tenantId?.toString() ?? 'unknown',
    actorId: user?._id?.toString() ?? null,
    actorRole: (user?.role as string | undefined) ?? null,
    action: 'auth.login.failed',
    resource: 'user',
    resourceId: user?._id?.toString() ?? null,
    after: { email, reason },
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    success: false,
    error: reason,
  });
}

export async function loginWithPassword(
  email: string,
  password: string,
  totp: string | undefined,
  ctx: LoginContext = {},
): Promise<LoginResult> {
  const user = await User.findOne({ email }).select(
    '+passwordHash +twoFactorSecret +failedLoginAttempts +lockedUntil',
  );
  if (!user) {
    await auditLoginFailure(email, 'INVALID_CREDENTIALS', null, ctx);
    throw new AppError('INVALID_CREDENTIALS');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await auditLoginFailure(email, 'ACCOUNT_LOCKED', user, ctx);
    throw new AppError('ACCOUNT_LOCKED');
  }
  if (user.status === 'SUSPENDED') {
    await auditLoginFailure(email, 'ACCOUNT_SUSPENDED', user, ctx);
    throw new AppError('ACCOUNT_SUSPENDED');
  }
  if (user.status === 'BLOCKED') {
    await auditLoginFailure(email, 'ACCOUNT_BLOCKED', user, ctx);
    throw new AppError('ACCOUNT_BLOCKED');
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    let reason = 'INVALID_CREDENTIALS';
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      user.failedLoginAttempts = 0;
      reason = 'ACCOUNT_LOCKED_THRESHOLD';
    }
    await user.save();
    await auditLoginFailure(email, reason, user, ctx);
    throw new AppError('INVALID_CREDENTIALS');
  }

  // 2FA enforcement:
  //   - SUPER_ADMIN must have 2FA enrolled. We refuse login without it so an
  //     unconfigured admin account can't slip into production unprotected.
  //   - Any user with twoFactorEnabled must present a valid TOTP.
  // The bypass for fresh super-admins to enrol is the dedicated `/auth/2fa/setup`
  // route which uses an out-of-band server-issued token, not password login.
  //
  // Dev-only bypass: when NODE_ENV !== 'production' AND the supplied
  // TOTP is the all-zero string `000000`, both gates are skipped.
  // This is a deliberate hole for local development (no Authenticator
  // app needed); the env check ensures production builds are never
  // affected. Documented + audited (we still write the audit row).
  const isDevTotpBypass = env.NODE_ENV !== 'production' && totp === '000000';

  if (user.role === 'SUPER_ADMIN' && !user.twoFactorEnabled && !isDevTotpBypass) {
    await auditLoginFailure(email, 'TOTP_ENROLMENT_REQUIRED', user, ctx);
    throw new AppError('TOTP_REQUIRED', {
      reason: 'SUPER_ADMIN accounts must enrol 2FA before sign-in',
      enrolUrl: '/auth/2fa/setup',
    });
  }
  if (user.twoFactorEnabled && !isDevTotpBypass) {
    if (!totp) {
      await auditLoginFailure(email, 'TOTP_REQUIRED', user, ctx);
      throw new AppError('TOTP_REQUIRED');
    }
    if (!user.twoFactorSecret || !verifyTotp(totp, user.twoFactorSecret)) {
      await auditLoginFailure(email, 'INVALID_TOTP', user, ctx);
      throw new AppError('INVALID_TOTP');
    }
  }

  // Snapshot the previous login IP BEFORE we overwrite it — used for the
  // new-device alert below. First-ever logins get no alert (lastLoginIp is
  // null), only IP changes for established accounts.
  const previousLoginIp = user.lastLoginIp ?? null;
  const currentIp = ctx.ip ?? null;

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.lastLoginIp = currentIp;
  await user.save();

  // Successful login audit row — paired with auditLoginFailure() so
  // forensics can replay every login attempt for a given user/email.
  await recordAudit({
    tenantId: user.tenantId.toString(),
    actorId: user._id.toString(),
    actorRole: user.role,
    action: 'auth.login.success',
    resource: 'user',
    resourceId: user._id.toString(),
    after: { email, devTotpBypass: isDevTotpBypass || undefined },
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    success: true,
  });

  // Fire-and-forget new-device alert. Conservative trigger: previous IP must
  // be set AND the new IP must differ. This catches "logged in from a new
  // location" without spamming on the very first sign-in. False-positive
  // rate is non-zero (NAT, mobile carrier IPs rotate) but tolerable for a
  // security signal — better to over-warn than miss an actual breach.
  if (previousLoginIp && currentIp && previousLoginIp !== currentIp) {
    void enqueueAlert(
      {
        event: 'LOGIN_NEW_DEVICE',
        vars: {
          ipAddress: currentIp,
          userAgent: ctx.userAgent ?? 'unknown',
          at: new Date().toISOString(),
        },
      },
      [{ kind: 'user', id: String(user._id) }],
      {
        tenantId: String(user.tenantId),
        correlationKey: `login:${String(user._id)}`,
      },
    );
  }

  const { accessToken, refreshToken } = await issueTokens(user, ctx);
  const defaults = getDefaultPermissionsForRole(user.role as Role);
  const permissions = Array.from(new Set([...defaults, ...(user.customPermissions ?? [])])).filter(
    (p) => !(user.deniedPermissions ?? []).includes(p),
  );

  return { user, accessToken, refreshToken, permissions };
}

export async function issueTokens(
  user: UserDoc,
  ctx: LoginContext = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  const jti = crypto.randomBytes(16).toString('hex');
  const refreshToken = signRefreshToken({ sub: String(user._id), jti });
  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role as Role,
    agencyId: user.agencyId ? String(user.agencyId) : null,
    distributorId: user.distributorId ? String(user.distributorId) : null,
  });

  await RefreshToken.create({
    userId: user._id,
    jti,
    tokenHash: hashToken(refreshToken),
    deviceFingerprint: ctx.deviceFingerprint ?? null,
    userAgent: ctx.userAgent ?? null,
    ip: ctx.ip ?? null,
    expiresAt: new Date(Date.now() + (ms as (v: string) => number)(env.JWT_REFRESH_TTL)),
  });

  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(
  token: string,
  ctx: LoginContext = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  const decoded = verifyRefreshToken(token);
  const stored = await RefreshToken.findOne({ jti: decoded.jti });
  if (!stored) throw new AppError('TOKEN_INVALID');
  if (stored.revokedAt) throw new AppError('TOKEN_INVALID');
  if (stored.tokenHash !== hashToken(token)) throw new AppError('TOKEN_INVALID');
  if (stored.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED');

  const user = await User.findById(stored.userId);
  if (!user) throw new AppError('TOKEN_INVALID');
  if (user.status !== 'ACTIVE' && user.status !== 'PENDING')
    throw new AppError('ACCOUNT_SUSPENDED');

  const next = await issueTokens(user, ctx);
  stored.revokedAt = new Date();
  stored.replacedByJti = (verifyRefreshToken(next.refreshToken) as { jti: string }).jti;
  await stored.save();
  return next;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const decoded = verifyRefreshToken(token);
    await RefreshToken.updateOne(
      { jti: decoded.jti, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  } catch {
    // Silent — logout should be best-effort even if token is malformed.
  }
}
