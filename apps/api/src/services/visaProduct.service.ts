// Admin + public read service for visa products.
//
// Pure CRUD over the VisaProductDoc Mongoose model with the same enrichment
// pattern as the holiday-package service:
//
//   • Slug derivation when `id` is missing (unique within tenant; falls back
//     to `<countryIso2>-<purpose>-<rand>` if no `name` is set).
//   • Nested-row ID assignment for documents/processSteps/faqs/priceMatrix
//     ({prefix}-{idx}-{rand4}) so the React editor's keys stay stable.
//
// Public reads are tenant-scoped + gated to `published: true` and live
// alongside (not in place of) the legacy `/visa/quote` mock endpoint.

import { randomBytes } from 'node:crypto';
import {
  AppError,
  type AdminVisaProduct,
  type AdminVisaProductListQuery,
  type AdminVisaProductSummary,
  type VisaFaq,
  type VisaPriceRow,
  type VisaProcessStep,
  type VisaProductDocument,
} from '@tripbng/shared';
import { VisaProductDocModel, type VisaProductDoc } from '../models/VisaProductDoc.js';

// ────────── Slug derivation ──────────

const MAX_SLUG_LEN = 120;

export function deriveSlug(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LEN) || 'visa'
  );
}

async function uniqueSlugForTenant(tenantId: string, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  for (let i = 0; i < 50; i++) {
    const exists = await VisaProductDocModel.exists({ _id: candidate, tenantId });
    if (!exists) return candidate;
    candidate = `${base}-${suffix++}`;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

// ────────── Nested ID assignment ──────────

function rand4(): string {
  return randomBytes(2).toString('hex');
}

function fillIds<T extends { id?: string }>(rows: T[] | undefined, prefix: string): T[] {
  if (!rows) return [];
  return rows.map((row, idx) => {
    if (row.id && row.id.length > 0) return row;
    return { ...row, id: `${prefix}-${idx}-${rand4()}` };
  });
}

function fillNestedIds(p: AdminVisaProduct): AdminVisaProduct {
  return {
    ...p,
    documents: fillIds(p.documents, 'doc') as VisaProductDocument[],
    processSteps: fillIds(p.processSteps, 'step') as VisaProcessStep[],
    faqs: fillIds(p.faqs, 'faq') as VisaFaq[],
    priceMatrix: fillIds(p.priceMatrix, 'price') as VisaPriceRow[],
  };
}

// ────────── Summary mapping ──────────

export function toSummary(doc: VisaProductDoc): AdminVisaProductSummary {
  return {
    id: doc._id,
    countryId: doc.countryId,
    countryName: doc.countryName,
    countryIso2: doc.countryIso2,
    region: doc.region,
    name: doc.name,
    purpose: doc.purpose,
    processingMode: doc.processingMode,
    entryType: doc.entryType,
    processingDays: doc.processingDays,
    consulateFeeInr: doc.consulateFeeInr ?? 0,
    serviceFeeInr: doc.serviceFeeInr ?? 0,
    urgentAvailable: doc.urgentAvailable ?? false,
    bannerImage: doc.bannerImage ?? undefined,
    rating: doc.rating ?? undefined,
    published: doc.published ?? false,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : undefined,
  };
}

// ────────── Admin CRUD ──────────

export async function listAdminProducts(
  tenantId: string,
  query: AdminVisaProductListQuery,
): Promise<AdminVisaProductSummary[]> {
  const filter: Record<string, unknown> = { tenantId };
  if (query.publishedOnly) filter.published = true;
  if (query.countryId) filter.countryId = query.countryId;
  if (query.q) {
    const re = new RegExp(escapeRegExp(query.q), 'i');
    filter.$or = [{ name: re }, { countryName: re }, { region: re }];
  }
  const docs = await VisaProductDocModel.find(filter)
    .sort({ updatedAt: -1 })
    .limit(query.limit)
    .lean<VisaProductDoc[]>();
  return docs.map(toSummary);
}

export async function getAdminProduct(tenantId: string, id: string): Promise<AdminVisaProduct> {
  const doc = await VisaProductDocModel.findOne({
    _id: id,
    tenantId,
  }).lean<VisaProductDoc | null>();
  if (!doc) throw new AppError('NOT_FOUND', { reason: `visa product ${id} not found` });
  return docToDto(doc);
}

export async function createProduct(
  tenantId: string,
  userId: string,
  input: AdminVisaProduct,
): Promise<AdminVisaProduct> {
  const enriched = fillNestedIds(input);

  // Slug base preference: explicit id → name → countryIso2-purpose.
  const seedForSlug = enriched.id || enriched.name || `${enriched.countryIso2}-${enriched.purpose}`;
  const baseSlug = deriveSlug(seedForSlug);
  const slug = await uniqueSlugForTenant(tenantId, baseSlug);

  const created = await VisaProductDocModel.create({
    _id: slug,
    tenantId,
    ...stripProductId(enriched),
    createdBy: userId,
    updatedBy: userId,
  });
  return docToDto(created.toObject() as VisaProductDoc);
}

export async function updateProduct(
  tenantId: string,
  userId: string,
  id: string,
  input: AdminVisaProduct,
): Promise<AdminVisaProduct> {
  const existing = await VisaProductDocModel.findOne({ _id: id, tenantId });
  if (!existing) throw new AppError('NOT_FOUND', { reason: `visa product ${id} not found` });

  const enriched = fillNestedIds(input);
  const updated = await VisaProductDocModel.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { ...stripProductId(enriched), updatedBy: userId } },
    { new: true, runValidators: true },
  ).lean<VisaProductDoc | null>();
  if (!updated) throw new AppError('NOT_FOUND', { reason: `visa product ${id} not found` });
  return docToDto(updated);
}

export async function deleteProduct(tenantId: string, id: string): Promise<void> {
  const res = await VisaProductDocModel.deleteOne({ _id: id, tenantId });
  if (res.deletedCount === 0) {
    throw new AppError('NOT_FOUND', { reason: `visa product ${id} not found` });
  }
}

// ────────── Public reads (tenant-scoped, published-only) ──────────

export interface PublicListQuery {
  q?: string;
  /** Country slug (matches `countryId`). */
  country?: string;
  /** ISO-2 alternative — accepted because the prompt's URL spec uses it. */
  iso2?: string;
  purpose?: string;
  limit?: number;
}

export async function listPublicProducts(
  tenantId: string,
  query: PublicListQuery,
): Promise<AdminVisaProductSummary[]> {
  const filter: Record<string, unknown> = { tenantId, published: true };
  if (query.country) filter.countryId = query.country;
  if (query.iso2) filter.countryIso2 = query.iso2.toUpperCase();
  if (query.purpose) filter.purpose = query.purpose;
  if (query.q) {
    const re = new RegExp(escapeRegExp(query.q), 'i');
    filter.$or = [{ name: re }, { countryName: re }];
  }
  const docs = await VisaProductDocModel.find(filter)
    .sort({ updatedAt: -1 })
    .limit(query.limit ?? 100)
    .lean<VisaProductDoc[]>();
  return docs.map(toSummary);
}

export async function getPublicProduct(tenantId: string, id: string): Promise<AdminVisaProduct> {
  const doc = await VisaProductDocModel.findOne({
    _id: id,
    tenantId,
    published: true,
  }).lean<VisaProductDoc | null>();
  if (!doc) throw new AppError('NOT_FOUND', { reason: `visa product ${id} not found` });
  return docToDto(doc);
}

/** Returns all published visa products for a single country, latest-first.
 *  Used by the customer "Curated visa products" section on /visa/countries/[id]. */
export async function listProductsForCountry(
  tenantId: string,
  countryId: string,
): Promise<AdminVisaProductSummary[]> {
  const docs = await VisaProductDocModel.find({
    tenantId,
    countryId,
    published: true,
  })
    .sort({ updatedAt: -1 })
    .lean<VisaProductDoc[]>();
  return docs.map(toSummary);
}

// ────────── Internals ──────────

function stripProductId(p: AdminVisaProduct): Omit<AdminVisaProduct, 'id'> {
  const copy: Partial<AdminVisaProduct> = { ...p };
  delete copy.id;
  return copy as Omit<AdminVisaProduct, 'id'>;
}

function docToDto(doc: VisaProductDoc): AdminVisaProduct {
  // Same shape-massaging trick as the holiday service: Mongoose's inferred
  // schema-types and Zod's inferred DTO type aren't structurally identical
  // because of how nullable + optional defaults differ. The runtime data
  // matches; TS just needs the cast.
  const {
    _id,
    tenantId: _t,
    createdBy: _c,
    updatedBy: _u,
    createdAt: _ca,
    updatedAt: _ua,
    __v: _v,
    ...rest
  } = doc as unknown as VisaProductDoc & {
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
  return { id: _id, ...(rest as unknown as Omit<AdminVisaProduct, 'id'>) };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
