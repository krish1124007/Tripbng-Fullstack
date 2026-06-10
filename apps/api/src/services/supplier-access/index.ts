import type { ProductType, SearchRequest } from '@tripbng/shared';
import { Agency } from '../../models/Agency.js';
import { Supplier } from '../../models/Supplier.js';
import { SupplierSource } from '../../models/SupplierSource.js';
import { SupplierMap } from '../../models/SupplierMap.js';
import { countryCodeForIata } from '../../data/airports.js';
import {
  evaluateSupplierAccess,
  type AccessDecision,
  type CandidateSupplier,
  type MapRow,
  type SourceRow,
  type TravelType,
} from './resolver.js';

export * from './resolver.js';

export interface SupplierAccessContext {
  tenantId: string;
  /** null for SUPER_ADMIN previews with no agency — agency layer is bypassed. */
  agencyId: string | null;
}

/**
 * Classify a search as DOMESTIC or INTERNATIONAL.
 *
 * A trip is INTERNATIONAL the moment any segment crosses a country border
 * (origin and destination in different countries) — multi-city itineraries are
 * domestic only if every leg stays within one country. Unknown airport codes
 * are treated conservatively as INTERNATIONAL so a missing reference row never
 * silently widens a domestic-only supplier.
 */
export function travelTypeForRequest(request: SearchRequest): TravelType {
  for (const seg of request.segments) {
    const o = countryCodeForIata(seg.origin);
    const d = countryCodeForIata(seg.destination);
    if (o === null || d === null || o !== d) return 'INTERNATIONAL';
  }
  return 'DOMESTIC';
}

/**
 * Gather the supplier/source/map rows + agency groups for a search and run the
 * pure resolver. Returns a per-supplier decision keyed by supplier code so the
 * search pipeline can both pre-filter adapters and post-filter results by
 * airline. See ./resolver.ts for the rule semantics.
 */
export async function resolveSupplierAccess(
  ctx: SupplierAccessContext,
  request: SearchRequest,
  candidateCodes: readonly string[],
  productType: ProductType = 'FLIGHT',
): Promise<AccessDecision> {
  const travelType = travelTypeForRequest(request);
  const travelDate = request.segments[0]?.date ?? new Date();

  const [supplierRows, agency, sourceRows, mapRows] = await Promise.all([
    Supplier.find({ tenantId: ctx.tenantId, code: { $in: [...candidateCodes] } })
      .select('code status')
      .lean(),
    ctx.agencyId
      ? Agency.findById(ctx.agencyId).select('agencyGroupIds').lean()
      : Promise.resolve(null),
    SupplierSource.find({ tenantId: ctx.tenantId, productType }).lean(),
    SupplierMap.find({ tenantId: ctx.tenantId, productType }).lean(),
  ]);

  const statusByCode = new Map(supplierRows.map((s) => [s.code, s] as const));
  const candidates: CandidateSupplier[] = candidateCodes.map((code) => {
    const row = statusByCode.get(code);
    return {
      code,
      supplierId: row ? String(row._id) : null,
      status: row ? (row.status as CandidateSupplier['status']) : null,
    };
  });

  const sources: SourceRow[] = sourceRows.map((s) => ({
    supplierId: String(s.supplierId),
    productType: s.productType as ProductType,
    travelType: s.travelType as SourceRow['travelType'],
    airlineCodes: (s.airlineCodes ?? []).map((a) => a.toUpperCase()),
    enabled: s.enabled,
  }));

  const maps: MapRow[] = mapRows.map((m) => ({
    productType: m.productType as ProductType,
    travelType: m.travelType as MapRow['travelType'],
    supplierIds: (m.supplierIds ?? []).map(String),
    agencyGroupIds: (m.agencyGroupIds ?? []).map(String),
    airlineCodes: (m.airlineCodes ?? []).map((a) => a.toUpperCase()),
    dateStart: m.dateStart ?? null,
    dateEnd: m.dateEnd ?? null,
    allowPendingBooking: m.allowPendingBooking ?? false,
    status: m.status as MapRow['status'],
  }));

  const agencyGroupIds = (agency?.agencyGroupIds ?? []).map(String);

  return evaluateSupplierAccess({
    productType,
    travelType,
    travelDate: new Date(travelDate),
    agencyGroupIds,
    bypassAgency: ctx.agencyId === null,
    candidates,
    sources,
    maps,
  });
}
