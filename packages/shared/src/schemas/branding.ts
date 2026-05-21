// Per-tenant branding — agency + distributor logo, name, and colour
// theming. Drives the partner-portal CSS variables and the chrome on
// every generated document (invoice, quote, voucher, receipt, refund
// note) plus transactional emails.
//
// Brief terminology:
//   "tenantType: agent|distributor" → we use `subjectKind: AGENCY|DISTRIBUTOR`
//   to avoid colliding with the multi-tenant `tenantId` already in scope
//   on every Mongo doc and the auth context.

import { z } from 'zod';

export const BRANDING_SUBJECT_KIND = ['AGENCY', 'DISTRIBUTOR'] as const;
export type BrandingSubjectKind = (typeof BRANDING_SUBJECT_KIND)[number];

/**
 * Hex colour — accepts #rgb / #rgba / #rrggbb / #rrggbbaa. Stored in
 * lowercase to keep audit diffs clean.
 */
export const HexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/, 'must be a #hex colour')
  .transform((v) => v.toLowerCase());

/**
 * Logo uploads come in as a data URL — PNG, JPEG, or WebP only. SVG is
 * explicitly disallowed until we have a hardened sanitizer in place;
 * the brief asked for DOMPurify but it isn't installed yet.
 */
export const LogoDataUrlSchema = z
  .string()
  .min(64)
  .max(5_500_000)
  .refine(
    (s) => /^data:image\/(png|jpeg|webp);base64,/i.test(s),
    'logo must be a data:image/(png|jpeg|webp);base64,... URL',
  );

export const UpdateBrandingRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(80).optional(),
  primaryColor: HexColorSchema.optional(),
  secondaryColor: HexColorSchema.optional(),
  /**
   * Optional manual override for the auto-derived hover. Leave null to
   * recompute from primaryColor via darken(0.1).
   */
  primaryHoverColor: HexColorSchema.nullable().optional(),
  /**
   * Optional manual override for foreground text on primary. Leave null
   * to recompute via WCAG luminance pick (#fff vs #0B1220).
   */
  primaryForegroundColor: HexColorSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateBrandingRequest = z.infer<typeof UpdateBrandingRequestSchema>;

export const UploadLogoRequestSchema = z.object({
  /** Base64 data URL — see LogoDataUrlSchema for accepted shapes. */
  dataUrl: LogoDataUrlSchema,
});
export type UploadLogoRequest = z.infer<typeof UploadLogoRequestSchema>;

/**
 * Public response shape — read by the web SSR layout, by the settings
 * page, and by every PDF / email renderer. `logoDataUrl` is only ever
 * populated for PDF callers (`BrandedDocumentService.resolveForBooking`)
 * because data URLs balloon the wire payload; the HTTP API returns
 * `logoPublicUrl` only.
 */
export const PublicBrandingSchema = z.object({
  subjectKind: z.enum(BRANDING_SUBJECT_KIND),
  subjectId: z.string(),
  companyName: z.string(),
  logoPublicUrl: z.string().nullable(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  primaryHoverColor: z.string(),
  primaryForegroundColor: z.string(),
  isActive: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type PublicBranding = z.infer<typeof PublicBrandingSchema>;

/**
 * Resolved branding handed to PDF + email renderers. Includes the
 * base64 logo for PDFs and the public URL for emails (Gmail strips
 * inline data URLs from images).
 */
export interface ResolvedBranding {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  primaryHoverColor: string;
  primaryForegroundColor: string;
  /** data:image/...;base64,... — present for PDF generation. */
  logoDataUrl: string | null;
  /** Absolute public URL — present for emails. */
  logoPublicUrl: string | null;
}

/**
 * Platform defaults — fall-back when isActive=false or no doc exists.
 * Single source of truth for both API and web.
 */
export const BRANDING_DEFAULTS = {
  companyName: 'TripBng',
  primaryColor: '#0f62fe',
  secondaryColor: '#10b981',
  primaryHoverColor: '#0050d8',
  primaryForegroundColor: '#ffffff',
  /** Web side falls back to its bundled <Logo /> when this is null. */
  logoPublicUrl: null as string | null,
} as const;

/**
 * Curated colour presets — used by the settings page color picker.
 * 8 brand-friendly hues; agents can also pick any custom hex.
 */
export const BRANDING_PRIMARY_PRESETS = [
  '#0f62fe', // IBM blue (default)
  '#ff5b49', // accent orange
  '#0e8c4d', // success green
  '#7c3aed', // violet
  '#b91c1c', // crimson
  '#0891b2', // teal
  '#b7791f', // amber
  '#0b1220', // ink-black
] as const;
export const BRANDING_SECONDARY_PRESETS = [
  '#10b981', // emerald (default)
  '#3b82f6', // sky
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#ef4444', // red
  '#14b8a6', // teal
  '#6b7280', // slate
] as const;
