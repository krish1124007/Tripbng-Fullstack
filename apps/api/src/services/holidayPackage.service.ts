// Admin + public read service for holiday packages.
//
// Pure CRUD over the HolidayPackageDoc Mongoose model with a few enrichments
// applied uniformly on create/update:
//
//   • Slug derivation when `id` is missing (ensures unique within tenant).
//   • Nested-row ID assignment ({prefix}-{idx}-{rand}) so the React editor's
//     keys stay stable across re-saves.
//   • `fromPerAdultPaise` re-derivation from the cheapest priceMatrix rate.
//
// Public reads (list / get) are tenant-scoped and gated to `published: true`.
// They live alongside (not in place of) the legacy `/holidays/search` mock —
// both endpoints are valid; the search mock keeps powering the existing card
// UX until the customer page is migrated to consume admin-authored packages
// (Phase D).

import { randomBytes } from 'node:crypto';
import {
  AppError,
  type AdminHolidayPackage,
  type AdminHolidayPackageListQuery,
  type AdminHolidayPackageSummary,
  type HolidayHotel,
  type HolidayPriceRow,
  type HolidaySightseeing,
  type HolidayFlightEntry,
} from '@tripbng/shared';
import { HolidayPackageDocModel, type HolidayPackageDoc } from '../models/HolidayPackageDoc.js';

// ────────── Slug derivation ──────────

const MAX_SLUG_LEN = 120;

/** Title → URL-safe lowercase slug. Strips diacritics, collapses runs of
 *  non-alphanumeric to a single hyphen, trims, caps length. */
export function deriveSlug(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LEN) || 'package'
  );
}

/** Returns the next available slug for a tenant, appending `-2`, `-3`, … on collision. */
async function uniqueSlugForTenant(tenantId: string, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  // 50 attempts — astronomically unlikely to need more for a single tenant.
  for (let i = 0; i < 50; i++) {
    const exists = await HolidayPackageDocModel.exists({ _id: candidate, tenantId });
    if (!exists) return candidate;
    candidate = `${base}-${suffix++}`;
  }
  // Last-resort: append a 6-char random — prevents an infinite loop on adversarial data.
  return `${base}-${randomBytes(3).toString('hex')}`;
}

// ────────── Nested ID assignment ──────────

function rand4(): string {
  return randomBytes(2).toString('hex');
}

/** Assigns `{prefix}-{idx}-{rand4}` to each row missing an `id`. Preserves
 *  existing ids so re-saves of admin-edited entries don't churn React keys. */
function fillIds<T extends { id?: string }>(rows: T[] | undefined, prefix: string): T[] {
  if (!rows) return [];
  return rows.map((row, idx) => {
    if (row.id && row.id.length > 0) return row;
    return { ...row, id: `${prefix}-${idx}-${rand4()}` };
  });
}

function fillNestedIds(pkg: AdminHolidayPackage): AdminHolidayPackage {
  const enriched: AdminHolidayPackage = { ...pkg };

  // hotelsPerCity / sightseeingPerCity are { cityKey: row[] } records.
  const hotelsPerCity: Record<string, HolidayHotel[]> = {};
  for (const [cityKey, list] of Object.entries(pkg.hotelsPerCity ?? {})) {
    hotelsPerCity[cityKey] = fillIds(list, `hotel-${cityKey}`);
  }
  enriched.hotelsPerCity = hotelsPerCity;

  const sightseeingPerCity: Record<string, HolidaySightseeing[]> = {};
  for (const [cityKey, list] of Object.entries(pkg.sightseeingPerCity ?? {})) {
    sightseeingPerCity[cityKey] = fillIds(list, `sight-${cityKey}`);
  }
  enriched.sightseeingPerCity = sightseeingPerCity;

  enriched.flights = fillIds(pkg.flights, 'flight') as HolidayFlightEntry[];
  enriched.priceMatrix = fillIds(pkg.priceMatrix, 'price') as HolidayPriceRow[];

  return enriched;
}

// ────────── Pricing derive ──────────

/** Cheapest INR per adult across the priceMatrix → paise as string (BigInt-safe). */
export function deriveFromPerAdultPaise(matrix: HolidayPriceRow[] | undefined): string {
  if (!matrix || matrix.length === 0) return '0';
  let cheapest = Number.POSITIVE_INFINITY;
  for (const row of matrix) {
    // Pick the smallest sharing-field on each row; that's the lowest published rate.
    const fields = [row.singleSharingInr, row.doubleSharingInr, row.tripleSharingInr].filter(
      (n) => typeof n === 'number' && n > 0,
    );
    for (const v of fields) if (v < cheapest) cheapest = v;
  }
  if (!Number.isFinite(cheapest)) return '0';
  // INR → paise (×100). Use BigInt to stay safe past Number.MAX_SAFE_INTEGER / 100.
  return (BigInt(Math.round(cheapest)) * 100n).toString();
}

// ────────── Summary mapping ──────────

export function toSummary(doc: HolidayPackageDoc): AdminHolidayPackageSummary {
  const fromPerAdultPaise = doc.fromPerAdultPaise ?? '0';
  // Convert paise string → rupees number for the legacy PackageCard prop.
  // The string is BigInt-safe; rupees fits Number for any realistic price.
  const fromPaiseNum = Number(BigInt(fromPerAdultPaise) / 100n);
  return {
    id: doc._id,
    title: doc.title,
    destination: doc.destination,
    nights: doc.nights,
    cities: (doc.cities ?? []).map((c) => c.city),
    inclusions: doc.inclusions ?? [],
    themeLabel: doc.themeLabel,
    themes: doc.themes ?? [],
    fromPerAdultPaise,
    perPaxRupees: fromPaiseNum,
    flightIncluded: doc.flightIncluded ?? false,
    bestSeller: doc.bestSeller ?? false,
    imageUrl: doc.heroImages?.[0],
    published: doc.published ?? false,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : undefined,
  };
}

// ────────── Admin CRUD ──────────

export async function listAdminPackages(
  tenantId: string,
  query: AdminHolidayPackageListQuery,
): Promise<AdminHolidayPackageSummary[]> {
  const filter: Record<string, unknown> = { tenantId };
  if (query.publishedOnly) filter.published = true;
  if (query.destinationId) filter.destination = query.destinationId;
  if (query.q) {
    const re = new RegExp(escapeRegExp(query.q), 'i');
    filter.$or = [{ title: re }, { destination: re }];
  }
  const docs = await HolidayPackageDocModel.find(filter)
    .sort({ updatedAt: -1 })
    .limit(query.limit)
    .lean<HolidayPackageDoc[]>();
  return docs.map(toSummary);
}

export async function getAdminPackage(tenantId: string, id: string): Promise<AdminHolidayPackage> {
  const doc = await HolidayPackageDocModel.findOne({
    _id: id,
    tenantId,
  }).lean<HolidayPackageDoc | null>();
  if (!doc) throw new AppError('NOT_FOUND', { reason: `holiday package ${id} not found` });
  return docToDto(doc);
}

export async function createPackage(
  tenantId: string,
  userId: string,
  input: AdminHolidayPackage,
): Promise<AdminHolidayPackage> {
  const enriched = fillNestedIds(input);
  enriched.fromPerAdultPaise = deriveFromPerAdultPaise(enriched.priceMatrix);

  const baseSlug = deriveSlug(enriched.id ?? enriched.title);
  const slug = enriched.id
    ? // Caller passed an explicit slug — respect it but ensure uniqueness within tenant.
      await uniqueSlugForTenant(tenantId, baseSlug)
    : await uniqueSlugForTenant(tenantId, baseSlug);

  const created = await HolidayPackageDocModel.create({
    _id: slug,
    tenantId,
    ...stripPackageId(enriched),
    createdBy: userId,
    updatedBy: userId,
  });
  return docToDto(created.toObject() as HolidayPackageDoc);
}

export async function updatePackage(
  tenantId: string,
  userId: string,
  id: string,
  input: AdminHolidayPackage,
): Promise<AdminHolidayPackage> {
  const existing = await HolidayPackageDocModel.findOne({ _id: id, tenantId });
  if (!existing) throw new AppError('NOT_FOUND', { reason: `holiday package ${id} not found` });

  const enriched = fillNestedIds(input);
  enriched.fromPerAdultPaise = deriveFromPerAdultPaise(enriched.priceMatrix);

  const updated = await HolidayPackageDocModel.findOneAndUpdate(
    { _id: id, tenantId },
    {
      $set: {
        ...stripPackageId(enriched),
        updatedBy: userId,
      },
    },
    { new: true, runValidators: true },
  ).lean<HolidayPackageDoc | null>();
  if (!updated) throw new AppError('NOT_FOUND', { reason: `holiday package ${id} not found` });
  return docToDto(updated);
}

export async function deletePackage(tenantId: string, id: string): Promise<void> {
  const res = await HolidayPackageDocModel.deleteOne({ _id: id, tenantId });
  if (res.deletedCount === 0) {
    throw new AppError('NOT_FOUND', { reason: `holiday package ${id} not found` });
  }
}

// ────────── Public reads (tenant-scoped, published-only) ──────────

export async function listPublicPackages(
  tenantId: string,
  query: AdminHolidayPackageListQuery,
): Promise<AdminHolidayPackageSummary[]> {
  return listAdminPackages(tenantId, { ...query, publishedOnly: true });
}

export async function getPublicPackage(tenantId: string, id: string): Promise<AdminHolidayPackage> {
  const doc = await HolidayPackageDocModel.findOne({
    _id: id,
    tenantId,
    published: true,
  }).lean<HolidayPackageDoc | null>();
  if (!doc) throw new AppError('NOT_FOUND', { reason: `holiday package ${id} not found` });
  return docToDto(doc);
}

// ────────── Internals ──────────

function stripPackageId(pkg: AdminHolidayPackage): Omit<AdminHolidayPackage, 'id'> {
  // Mongo `_id` carries the slug; we don't store `id` separately on the doc.
  const copy: Partial<AdminHolidayPackage> = { ...pkg };
  delete copy.id;
  return copy as Omit<AdminHolidayPackage, 'id'>;
}

function docToDto(doc: HolidayPackageDoc): AdminHolidayPackage {
  // Mongoose adds a few extras (timestamps, __v); strip what doesn't belong on the DTO.
  const {
    _id,
    tenantId: _t,
    createdBy: _c,
    updatedBy: _u,
    createdAt: _ca,
    updatedAt: _ua,
    __v: _v,
    ...rest
  } = doc as unknown as HolidayPackageDoc & {
    _id: string;
    tenantId: unknown;
    createdBy: unknown;
    updatedBy: unknown;
    createdAt?: Date;
    updatedAt?: Date;
    __v?: number;
  };
  void _t;
  void _c;
  void _u;
  void _ca;
  void _ua;
  void _v;
  // Cast: HolidayPackageDocData (Mongoose-inferred) and AdminHolidayPackage
  // (Zod-inferred) share field names but differ in date-vs-string nuances on
  // the dynamic Mixed sub-trees. The runtime data matches; TS just needs help.
  return { id: _id, ...(rest as unknown as Omit<AdminHolidayPackage, 'id'>) };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
