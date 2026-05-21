// BrandedDocument service — single source of truth for "what does
// this booking's PDF / email look like?". Resolves the correct
// branding doc for a given subject (AGENCY / DISTRIBUTOR) and returns
// it in the shape the PDF + email renderers want.
//
// Hot path — every booking confirmation, voucher download, invoice
// render, etc. calls in here. Backed by a 60s Redis cache with
// per-write invalidation.
//
// Resolution order:
//   resolveForTenant(subjectKind, subjectId)
//     → Mongo lookup (cache-aside)
//     → if isActive=false or no doc, fall back to defaults
//     → return ResolvedBranding (logo as base64 for PDFs, URL for emails)
//
//   resolveForBooking(bookingId)
//     → look up the booking, pick the right subject:
//         AGENCY booking      → branding owned by booking.agencyId
//         no agency / direct  → branding owned by booking.distributorId
//         neither             → platform defaults
//     → delegate to resolveForTenant

import { Types } from 'mongoose';
import {
  BRANDING_DEFAULTS,
  type BrandingSubjectKind,
  type PublicBranding,
  type ResolvedBranding,
} from '@tripbng/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import { TenantBranding, type TenantBrandingDoc } from '../../models/TenantBranding.js';
import { Booking } from '../../models/Booking.js';
import { readFile } from '../storage/local-storage.service.js';

const CACHE_VERSION = 'v1';
const cacheKey = (subjectKind: BrandingSubjectKind, subjectId: string) =>
  `branding:${CACHE_VERSION}:${subjectKind}:${subjectId}`;

/**
 * Public read shape — what the HTTP API returns. Excludes the base64
 * logo because data URLs balloon JSON payloads.
 */
export function serializeBranding(b: TenantBrandingDoc): PublicBranding {
  return {
    subjectKind: b.subjectKind as BrandingSubjectKind,
    subjectId: String(b.subjectId),
    companyName: b.companyName,
    logoPublicUrl: b.logoPublicUrl ?? null,
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    primaryHoverColor: b.primaryHoverColor,
    primaryForegroundColor: b.primaryForegroundColor,
    isActive: b.isActive ?? true,
    updatedAt: b.updatedAt.toISOString(),
  };
}

function defaultsFor(subjectKind: BrandingSubjectKind, subjectId: string): PublicBranding {
  return {
    subjectKind,
    subjectId,
    companyName: BRANDING_DEFAULTS.companyName,
    logoPublicUrl: BRANDING_DEFAULTS.logoPublicUrl,
    primaryColor: BRANDING_DEFAULTS.primaryColor,
    secondaryColor: BRANDING_DEFAULTS.secondaryColor,
    primaryHoverColor: BRANDING_DEFAULTS.primaryHoverColor,
    primaryForegroundColor: BRANDING_DEFAULTS.primaryForegroundColor,
    isActive: false,
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Cache-aside lookup of the public branding for a subject. Falls back
 * to platform defaults when no row exists or `isActive=false`.
 */
export async function resolveBrandingPublic(
  tenantId: string,
  subjectKind: BrandingSubjectKind,
  subjectId: string,
): Promise<PublicBranding> {
  const key = cacheKey(subjectKind, subjectId);
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as PublicBranding;
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, 'branding.cache.read.failed');
  }
  const doc = await TenantBranding.findOne({
    tenantId: new Types.ObjectId(tenantId),
    subjectKind,
    subjectId: new Types.ObjectId(subjectId),
  });
  const out: PublicBranding =
    doc && doc.isActive ? serializeBranding(doc) : defaultsFor(subjectKind, subjectId);
  try {
    await redis.set(key, JSON.stringify(out), 'EX', env.BRANDING_CACHE_TTL);
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, 'branding.cache.write.failed');
  }
  return out;
}

/** Bust the cache key for a subject — called after every write. */
export async function invalidateBrandingCache(
  subjectKind: BrandingSubjectKind,
  subjectId: string,
): Promise<void> {
  const key = cacheKey(subjectKind, subjectId);
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, 'branding.cache.invalidate.failed');
  }
}

/**
 * Resolve branding for a subject and inflate the logo as both a base64
 * data URL (for PDFs) and the public URL (for emails). The PDF data
 * URL is mime-prefixed so pdfkit's image() helper can decode it.
 */
export async function resolveForTenant(
  tenantId: string,
  subjectKind: BrandingSubjectKind,
  subjectId: string,
): Promise<ResolvedBranding> {
  const pub = await resolveBrandingPublic(tenantId, subjectKind, subjectId);
  let logoDataUrl: string | null = null;
  // Re-fetch the doc so we can read the on-disk file. The cache only
  // holds the public shape — the logoPath isn't there.
  if (pub.isActive && pub.logoPublicUrl) {
    const doc = await TenantBranding.findOne({
      tenantId: new Types.ObjectId(tenantId),
      subjectKind,
      subjectId: new Types.ObjectId(subjectId),
    }).lean();
    if (doc?.logoPath) {
      try {
        // logoPath is the relative path returned by LocalStorage —
        // safeJoin inside readFile enforces the traversal boundary.
        const buf = await readFile(doc.logoPath);
        // Note: SVG logos work end-to-end on emails (recipient's mail
        // client loads them via public URL) but pdfkit's image()
        // doesn't accept SVG. For the PDF data URL we deliberately
        // skip SVG — the renderer falls back to the platform vector
        // mark when logoDataUrl is null, which is the right behaviour.
        const mime = doc.logoPath.endsWith('.png')
          ? 'image/png'
          : doc.logoPath.endsWith('.webp')
            ? 'image/webp'
            : doc.logoPath.endsWith('.svg')
              ? null // skip — see note above
              : 'image/jpeg';
        if (mime) {
          logoDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, path: doc.logoPath },
          'branding.logo.read.failed',
        );
      }
    }
  }
  // Absolute public URL — emails need it so the recipient's mail
  // client can fetch the image cross-origin.
  const absoluteUrl = pub.logoPublicUrl
    ? (env.API_PUBLIC_BASE_URL ?? env.API_BASE_URL) + pub.logoPublicUrl
    : null;
  return {
    companyName: pub.companyName,
    primaryColor: pub.primaryColor,
    secondaryColor: pub.secondaryColor,
    primaryHoverColor: pub.primaryHoverColor,
    primaryForegroundColor: pub.primaryForegroundColor,
    logoDataUrl,
    logoPublicUrl: absoluteUrl,
  };
}

/**
 * Resolve branding for an already-loaded booking doc (any product —
 * hotel, holiday, visa, bus, flight). Saves a redundant Booking
 * lookup vs `resolveForBooking`. Pick the agency-owned branding when
 * agencyId is present, otherwise the distributor's, otherwise
 * platform defaults.
 */
export async function resolveForAgencyOrDistributor(
  tenantId: string | undefined | null,
  agencyId: string | undefined | null,
  distributorId: string | undefined | null,
): Promise<ResolvedBranding> {
  if (!tenantId) return platformDefaults();
  if (agencyId) return resolveForTenant(tenantId, 'AGENCY', agencyId);
  if (distributorId) return resolveForTenant(tenantId, 'DISTRIBUTOR', distributorId);
  return platformDefaults();
}

/**
 * Resolve branding for a booking — looks up the booking, picks the
 * agency-owned branding if present, falls back to the distributor's
 * branding, and finally to platform defaults.
 */
export async function resolveForBooking(bookingId: string): Promise<ResolvedBranding> {
  if (!Types.ObjectId.isValid(bookingId)) {
    return platformDefaults();
  }
  const b = await Booking.findById(bookingId).select(
    'tenantId agencyId distributorId',
  );
  if (!b) return platformDefaults();
  const tenantId = String(b.tenantId);
  if (b.agencyId) {
    return resolveForTenant(tenantId, 'AGENCY', String(b.agencyId));
  }
  if (b.distributorId) {
    return resolveForTenant(tenantId, 'DISTRIBUTOR', String(b.distributorId));
  }
  return platformDefaults();
}

/** Resolved-shape platform defaults — for callers without a subject. */
export function platformDefaults(): ResolvedBranding {
  return {
    companyName: BRANDING_DEFAULTS.companyName,
    primaryColor: BRANDING_DEFAULTS.primaryColor,
    secondaryColor: BRANDING_DEFAULTS.secondaryColor,
    primaryHoverColor: BRANDING_DEFAULTS.primaryHoverColor,
    primaryForegroundColor: BRANDING_DEFAULTS.primaryForegroundColor,
    logoDataUrl: null,
    logoPublicUrl: null,
  };
}
