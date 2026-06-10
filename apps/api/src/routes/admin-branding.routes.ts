// Admin branding routes — SUPER_ADMIN can override any tenant's
// branding on their behalf. Same shape as the owner-facing routes
// but mounted under /api/v1/admin/branding/:subjectKind/:subjectId,
// and every mutation is audited with action='branding.admin_override'.
//
// Endpoints:
//   GET    /admin/branding/:subjectKind/:subjectId
//   PUT    /admin/branding/:subjectKind/:subjectId
//   POST   /admin/branding/:subjectKind/:subjectId/logo
//   DELETE /admin/branding/:subjectKind/:subjectId/logo
//   POST   /admin/branding/:subjectKind/:subjectId/reset
//   GET    /admin/branding/:subjectKind/:subjectId/audit  → recent audit entries

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  BRANDING_DEFAULTS,
  BRANDING_SUBJECT_KIND,
  UpdateBrandingRequestSchema,
  UploadLogoRequestSchema,
  type BrandingSubjectKind,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { TenantBranding } from '../models/TenantBranding.js';
import { AuditLog } from '../models/AuditLog.js';
import {
  invalidateBrandingCache,
  resolveBrandingPublic,
  serializeBranding,
} from '../services/branding/branded-document.service.js';
import { deleteFile, saveBrandingLogo } from '../services/storage/local-storage.service.js';
import { darken, pickReadableTextColor } from '../utils/color.js';
import { recordAudit } from '../services/audit.service.js';

export const adminBrandingRouter: RouterT = Router();
adminBrandingRouter.use(authenticate, requireAuth);

function validateSubjectParams(
  kindRaw: string,
  idRaw: string,
): { subjectKind: BrandingSubjectKind; subjectId: string } {
  const upper = kindRaw.toUpperCase();
  if (!BRANDING_SUBJECT_KIND.includes(upper as BrandingSubjectKind)) {
    throw new AppError('NOT_FOUND', { reason: `unknown subjectKind ${kindRaw}` });
  }
  if (!/^[a-fA-F0-9]{24}$/.test(idRaw)) {
    throw new AppError('NOT_FOUND', { reason: 'invalid subjectId' });
  }
  return { subjectKind: upper as BrandingSubjectKind, subjectId: idRaw };
}

function decodeDataUrl(dataUrl: string): Buffer {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) throw new AppError('VALIDATION_ERROR', { reason: 'malformed data URL' });
  return Buffer.from(dataUrl.slice(idx + 1), 'base64');
}

adminBrandingRouter.get(
  '/:subjectKind/:subjectId',
  requirePermission('branding:admin'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = validateSubjectParams(
        req.params.subjectKind,
        req.params.subjectId,
      );
      const out = await resolveBrandingPublic(req.auth!.tenantId, subjectKind, subjectId);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

adminBrandingRouter.put(
  '/:subjectKind/:subjectId',
  requirePermission('branding:admin'),
  validate(UpdateBrandingRequestSchema),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = validateSubjectParams(
        req.params.subjectKind,
        req.params.subjectId,
      );
      const input = req.body as ReturnType<typeof UpdateBrandingRequestSchema.parse>;
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);

      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      const before = existing ? serializeBranding(existing) : null;

      const next = {
        companyName: input.companyName ?? existing?.companyName ?? BRANDING_DEFAULTS.companyName,
        primaryColor:
          input.primaryColor ?? existing?.primaryColor ?? BRANDING_DEFAULTS.primaryColor,
        secondaryColor:
          input.secondaryColor ?? existing?.secondaryColor ?? BRANDING_DEFAULTS.secondaryColor,
        primaryHoverColor: '',
        primaryForegroundColor: '',
        isActive: input.isActive ?? existing?.isActive ?? true,
      };
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
      // 'admin_override' as the audit action — distinguishes from the
      // owner's own 'branding.update' so reviewers can spot admin
      // edits in the timeline.
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'branding.admin_override',
        resource: 'branding',
        resourceId: String(updated._id),
        before,
        after,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

adminBrandingRouter.post(
  '/:subjectKind/:subjectId/logo',
  requirePermission('branding:admin'),
  validate(UploadLogoRequestSchema),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = validateSubjectParams(
        req.params.subjectKind,
        req.params.subjectId,
      );
      const input = req.body as ReturnType<typeof UploadLogoRequestSchema.parse>;
      const buffer = decodeDataUrl(input.dataUrl);
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);

      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      const before = existing ? serializeBranding(existing) : null;
      const previousLogoPath = existing?.logoPath ?? null;
      const saved = await saveBrandingLogo({ subjectKind, subjectId, buffer });

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
      if (previousLogoPath && previousLogoPath !== saved.relativePath) {
        void deleteFile(previousLogoPath);
      }
      await invalidateBrandingCache(subjectKind, subjectId);
      const after = serializeBranding(updated);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'branding.admin_override',
        resource: 'branding',
        resourceId: String(updated._id),
        before,
        after: { ...after, bytes: saved.bytes, ext: saved.ext, op: 'logo.upload' },
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

adminBrandingRouter.delete(
  '/:subjectKind/:subjectId/logo',
  requirePermission('branding:admin'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = validateSubjectParams(
        req.params.subjectKind,
        req.params.subjectId,
      );
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);
      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      if (!existing) throw new AppError('NOT_FOUND');
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
        action: 'branding.admin_override',
        resource: 'branding',
        resourceId: String(existing._id),
        before,
        after: { ...after, op: 'logo.delete' },
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

adminBrandingRouter.post(
  '/:subjectKind/:subjectId/reset',
  requirePermission('branding:admin'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = validateSubjectParams(
        req.params.subjectKind,
        req.params.subjectId,
      );
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const subjectOid = new Types.ObjectId(subjectId);
      const existing = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: subjectOid,
      });
      const before = existing ? serializeBranding(existing) : null;
      const prevPath = existing?.logoPath ?? null;
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
        action: 'branding.admin_override',
        resource: 'branding',
        resourceId: String(updated._id),
        before,
        after: { ...after, op: 'reset' },
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      return ok(res, after);
    } catch (err) {
      next(err);
    }
  },
);

// Audit timeline for a subject — used by the admin branding panel
// to show "who changed what when".
adminBrandingRouter.get(
  '/:subjectKind/:subjectId/audit',
  requirePermission('branding:admin'),
  async (req, res, next) => {
    try {
      const { subjectKind, subjectId } = validateSubjectParams(
        req.params.subjectKind,
        req.params.subjectId,
      );
      const tenantOid = new Types.ObjectId(req.auth!.tenantId);
      const doc = await TenantBranding.findOne({
        tenantId: tenantOid,
        subjectKind,
        subjectId: new Types.ObjectId(subjectId),
      }).select('_id');
      if (!doc) return ok(res, []);
      const rows = await AuditLog.find({
        tenantId: req.auth!.tenantId,
        resource: 'branding',
        resourceId: String(doc._id),
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      return ok(res, rows);
    } catch (err) {
      next(err);
    }
  },
);
