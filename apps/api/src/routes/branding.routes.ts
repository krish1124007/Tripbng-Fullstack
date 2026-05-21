// Tenant branding routes — owners (AGENCY / DISTRIBUTOR users)
// manage their own logo + colour theme. Mounted at /api/v1/settings/
// branding.
//
// Endpoints:
//   GET    /settings/branding         → resolved public shape
//   PUT    /settings/branding         → patch colours / companyName / isActive
//   POST   /settings/branding/logo    → upload logo (data URL)
//   DELETE /settings/branding/logo    → remove logo, keep colours
//   POST   /settings/branding/reset   → wipe doc + delete logo, fall back to defaults

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  BRANDING_DEFAULTS,
  UpdateBrandingRequestSchema,
  UploadLogoRequestSchema,
  type BrandingSubjectKind,
} from '@tripbng/shared';
import { authenticate, requireAuth, type AuthContext } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { TenantBranding } from '../models/TenantBranding.js';
import {
  invalidateBrandingCache,
  resolveBrandingPublic,
  serializeBranding,
} from '../services/branding/branded-document.service.js';
import { deleteFile, saveBrandingLogo } from '../services/storage/local-storage.service.js';
import { darken, pickReadableTextColor } from '../utils/color.js';
import { recordAudit } from '../services/audit.service.js';

export const brandingRouter: RouterT = Router();
brandingRouter.use(authenticate, requireAuth);

/**
 * Branding snapshot cookie — read by the Next.js root layout to paint
 * the per-tenant CSS variables before React hydrates. Non-HttpOnly
 * because it's purely cosmetic (no PII, no secret). Refreshed on
 * every successful PUT / logo upload / logo delete / reset.
 *
 * Lifetime matches a typical user session; the cookie is cosmetic so
 * a stale value just means a brief flash to the right theme on next
 * page nav.
 */
const BRANDING_COOKIE = 'tripbng_branding';
function setBrandingCookie(
  res: import('express').Response,
  pub: ReturnType<typeof serializeBranding>,
): void {
  // Compact payload — only the fields the SSR style-tag needs.
  const slim = {
    subjectKind: pub.subjectKind,
    subjectId: pub.subjectId,
    primaryColor: pub.primaryColor,
    secondaryColor: pub.secondaryColor,
    primaryHoverColor: pub.primaryHoverColor,
    primaryForegroundColor: pub.primaryForegroundColor,
    isActive: pub.isActive,
    companyName: pub.companyName,
    logoPublicUrl: pub.logoPublicUrl,
    updatedAt: pub.updatedAt,
  };
  res.cookie(BRANDING_COOKIE, encodeURIComponent(JSON.stringify(slim)), {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

/**
 * Pull the (subjectKind, subjectId) for the calling user. AGENCY +
 * SUB_AGENT brand at the agency level; DISTRIBUTOR brands at the
 * distributor level. Anyone else gets a 403.
 */
function subjectFromAuth(auth: AuthContext): {
  subjectKind: BrandingSubjectKind;
  subjectId: string;
} {
  if (auth.role === 'AGENCY' || auth.role === 'SUB_AGENT') {
    if (!auth.agencyId) {
      throw new AppError('VALIDATION_ERROR', { reason: 'agency context missing' });
    }
    return { subjectKind: 'AGENCY', subjectId: auth.agencyId };
  }
  if (auth.role === 'DISTRIBUTOR') {
    if (!auth.distributorId) {
      throw new AppError('VALIDATION_ERROR', { reason: 'distributor context missing' });
    }
    return { subjectKind: 'DISTRIBUTOR', subjectId: auth.distributorId };
  }
  throw new AppError('FORBIDDEN', { reason: 'role cannot own branding' });
}

/** Decode a data:image/...;base64,... URL into a Buffer. */
function decodeDataUrl(dataUrl: string): Buffer {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) throw new AppError('VALIDATION_ERROR', { reason: 'malformed data URL' });
  return Buffer.from(dataUrl.slice(idx + 1), 'base64');
}

brandingRouter.get(
  '/',
  requirePermission('branding:read:own'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = subjectFromAuth(req.auth!);
      const out = await resolveBrandingPublic(req.auth!.tenantId, subjectKind, subjectId);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

brandingRouter.put(
  '/',
  requirePermission('branding:update:own'),
  validate(UpdateBrandingRequestSchema),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = subjectFromAuth(req.auth!);
      const input = req.body as ReturnType<typeof UpdateBrandingRequestSchema.parse>;

      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);

      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      const before = existing ? serializeBranding(existing) : null;

      // Auto-derive primaryHoverColor + primaryForegroundColor when the
      // primary changes and the caller didn't override them explicitly.
      const next = {
        companyName: input.companyName ?? existing?.companyName ?? BRANDING_DEFAULTS.companyName,
        primaryColor: input.primaryColor ?? existing?.primaryColor ?? BRANDING_DEFAULTS.primaryColor,
        secondaryColor:
          input.secondaryColor ?? existing?.secondaryColor ?? BRANDING_DEFAULTS.secondaryColor,
        primaryHoverColor: '',
        primaryForegroundColor: '',
        isActive: input.isActive ?? existing?.isActive ?? true,
      };
      // primaryHoverColor: explicit override (input) > existing (when primary unchanged) > derive.
      const primaryChanged = !existing || existing.primaryColor !== next.primaryColor;
      next.primaryHoverColor =
        input.primaryHoverColor === null
          ? darken(next.primaryColor, 0.1)
          : input.primaryHoverColor !== undefined
            ? input.primaryHoverColor
            : !primaryChanged && existing?.primaryHoverColor
              ? existing.primaryHoverColor
              : darken(next.primaryColor, 0.1);
      next.primaryForegroundColor =
        input.primaryForegroundColor === null
          ? pickReadableTextColor(next.primaryColor)
          : input.primaryForegroundColor !== undefined
            ? input.primaryForegroundColor
            : !primaryChanged && existing?.primaryForegroundColor
              ? existing.primaryForegroundColor
              : pickReadableTextColor(next.primaryColor);

      const updated = await TenantBranding.findOneAndUpdate(
        { tenantId: tenantOid, subjectKind, subjectId: subjectOid },
        {
          $set: { ...next, updatedBy: new Types.ObjectId(req.auth!.userId) },
          $setOnInsert: { tenantId: tenantOid, subjectKind, subjectId: subjectOid },
        },
        { new: true, upsert: true },
      );

      await invalidateBrandingCache(subjectKind, subjectId);
      const after = serializeBranding(updated);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'branding.update',
        resource: 'branding',
        resourceId: String(updated._id),
        before,
        after,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      setBrandingCookie(res, after);
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

brandingRouter.post(
  '/logo',
  requirePermission('branding:update:own'),
  validate(UploadLogoRequestSchema),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = subjectFromAuth(req.auth!);
      const input = req.body as ReturnType<typeof UploadLogoRequestSchema.parse>;
      const buffer = decodeDataUrl(input.dataUrl);

      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);

      // Existing logo path (if any) — deleted AFTER the new write
      // succeeds so we never leave a subject without a logo on failure.
      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      const previousLogoPath = existing?.logoPath ?? null;
      const before = existing ? serializeBranding(existing) : null;

      const saved = await saveBrandingLogo({
        subjectKind,
        subjectId,
        buffer,
      });

      // Upsert the doc — fill in defaults if this is the first save.
      const updated = await TenantBranding.findOneAndUpdate(
        { tenantId: tenantOid, subjectKind, subjectId: subjectOid },
        {
          $set: {
            logoPath: saved.relativePath,
            logoPublicUrl: saved.publicUrl,
            updatedBy: new Types.ObjectId(req.auth!.userId),
          },
          $setOnInsert: {
            tenantId: tenantOid,
            subjectKind,
            subjectId: subjectOid,
            companyName: BRANDING_DEFAULTS.companyName,
            primaryColor: BRANDING_DEFAULTS.primaryColor,
            secondaryColor: BRANDING_DEFAULTS.secondaryColor,
            primaryHoverColor: BRANDING_DEFAULTS.primaryHoverColor,
            primaryForegroundColor: BRANDING_DEFAULTS.primaryForegroundColor,
            isActive: true,
          },
        },
        { new: true, upsert: true },
      );

      // Best-effort orphan cleanup — never block the success response.
      if (previousLogoPath && previousLogoPath !== saved.relativePath) {
        void deleteFile(previousLogoPath);
      }

      await invalidateBrandingCache(subjectKind, subjectId);
      const after = serializeBranding(updated);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'branding.logo.upload',
        resource: 'branding',
        resourceId: String(updated._id),
        before,
        after: { ...after, bytes: saved.bytes, ext: saved.ext },
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      setBrandingCookie(res, after);
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

brandingRouter.delete(
  '/logo',
  requirePermission('branding:update:own'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = subjectFromAuth(req.auth!);
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);
      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      if (!existing) throw new AppError('NOT_FOUND', { reason: 'no branding doc' });
      const before = serializeBranding(existing);
      const prev = existing.logoPath;
      existing.logoPath = null;
      existing.logoPublicUrl = null;
      existing.updatedBy = new Types.ObjectId(req.auth!.userId);
      await existing.save();
      if (prev) void deleteFile(prev);
      await invalidateBrandingCache(subjectKind, subjectId);
      const after = serializeBranding(existing);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'branding.logo.delete',
        resource: 'branding',
        resourceId: String(existing._id),
        before,
        after,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      setBrandingCookie(res, after);
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

brandingRouter.post(
  '/reset',
  requirePermission('branding:update:own'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = subjectFromAuth(req.auth!);
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);
      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      const before = existing ? serializeBranding(existing) : null;
      const prevPath = existing?.logoPath ?? null;
      // Reset = wipe colour + logo back to platform defaults, mark
      // isActive=false so the resolver short-circuits to defaults.
      // We KEEP the doc so the lastResetBy / lastResetAt fields stick.
      const updated = await TenantBranding.findOneAndUpdate(
        { tenantId: tenantOid, subjectKind, subjectId: subjectOid },
        {
          $set: {
            companyName: BRANDING_DEFAULTS.companyName,
            logoPath: null,
            logoPublicUrl: null,
            primaryColor: BRANDING_DEFAULTS.primaryColor,
            secondaryColor: BRANDING_DEFAULTS.secondaryColor,
            primaryHoverColor: BRANDING_DEFAULTS.primaryHoverColor,
            primaryForegroundColor: BRANDING_DEFAULTS.primaryForegroundColor,
            isActive: false,
            lastResetBy: new Types.ObjectId(req.auth!.userId),
            lastResetAt: new Date(),
            updatedBy: new Types.ObjectId(req.auth!.userId),
          },
          $setOnInsert: { tenantId: tenantOid, subjectKind, subjectId: subjectOid },
        },
        { new: true, upsert: true },
      );
      if (prevPath) void deleteFile(prevPath);
      await invalidateBrandingCache(subjectKind, subjectId);
      const after = serializeBranding(updated);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'branding.reset',
        resource: 'branding',
        resourceId: String(updated._id),
        before,
        after,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      setBrandingCookie(res, after);
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);
