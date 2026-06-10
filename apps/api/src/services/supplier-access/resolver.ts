import type { ProductType, SupplierStatus } from '@tripbng/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Centralized supplier-access rules engine (Module 3 core).
//
// `evaluateSupplierAccess` is the single source of truth for "which suppliers
// may answer this search". It is a PURE function — no DB, no clock, no I/O — so
// the 4-layer rule set is exhaustively unit-testable. The DB loader in
// ./index.ts gathers the rows and calls this.
//
// The 4 layers, in order (CORE RULE — a supplier ships only if it passes ALL):
//   1. Supplier Active   — the Supplier row's status is ACTIVE
//   2. Source Active     — an enabled SupplierSource routes this supplier for
//                          the product + travel type
//   3. Mapping Allowed   — an ACTIVE SupplierMap rule matches product/travel/date
//   4. Agency Authorized — that same rule's agency-group scope includes the caller
//
// FAIL-OPEN (chosen rollout policy): a layer that has NO configuration for the
// tenant+productType is skipped rather than denying everyone. So an unconfigured
// tenant behaves exactly as before this engine existed (all active suppliers
// visible), and each layer only starts gating once an admin populates it.
// ─────────────────────────────────────────────────────────────────────────────

/** Concrete travel type for a single search (BOTH is a config value, never an input). */
export type TravelType = 'DOMESTIC' | 'INTERNATIONAL';
export type MapTravelType = 'DOMESTIC' | 'INTERNATIONAL' | 'BOTH';

/** One adapter the pipeline could call, joined to its Supplier DB row (if any). */
export interface CandidateSupplier {
  code: string;
  /** Supplier._id as a string, or null for env-registered adapters with no DB row. */
  supplierId: string | null;
  /** Supplier.status, or null when there is no DB row. */
  status: SupplierStatus | null;
}

/** A SupplierSource row, flattened to the fields the resolver needs. */
export interface SourceRow {
  supplierId: string;
  productType: ProductType;
  travelType: MapTravelType;
  airlineCodes: string[];
  enabled: boolean;
}

/** A SupplierMap row, flattened to the fields the resolver needs. */
export interface MapRow {
  productType: ProductType;
  travelType: MapTravelType;
  /** Empty = every supplier. */
  supplierIds: string[];
  /** Empty = every agency group. */
  agencyGroupIds: string[];
  /** Empty = all airlines. */
  airlineCodes: string[];
  dateStart: Date | null;
  dateEnd: Date | null;
  allowPendingBooking: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface AccessInput {
  productType: ProductType;
  travelType: TravelType;
  /** The travel date being searched — checked against each rule's date window. */
  travelDate: Date;
  /** Agency groups the caller belongs to. */
  agencyGroupIds: string[];
  /**
   * When true (e.g. a SUPER_ADMIN price preview with no agency context), the
   * agency-authorization layer is satisfied automatically. Mapping/source/active
   * layers still apply.
   */
  bypassAgency?: boolean;
  candidates: CandidateSupplier[];
  sources: SourceRow[];
  maps: MapRow[];
}

export type DenyLayer = 'SUPPLIER_INACTIVE' | 'SOURCE_INACTIVE' | 'MAPPING_DENIED' | 'AGENCY_DENIED';

export interface SupplierDecision {
  code: string;
  allowed: boolean;
  /** Layer that rejected the supplier, or a human note when allowed. */
  reason: DenyLayer | 'ALLOWED';
  /** Allowed airline IATA codes; null = unrestricted. */
  allowedAirlines: string[] | null;
  /** Whether hold/pending fares may be surfaced for this supplier. */
  allowPendingBooking: boolean;
}

export interface AccessDecision {
  decisions: SupplierDecision[];
  allowedCodes: string[];
  byCode: Record<string, SupplierDecision>;
}

function travelTypeMatches(rule: MapTravelType, search: TravelType): boolean {
  return rule === 'BOTH' || rule === search;
}

function dateInWindow(date: Date, start: Date | null, end: Date | null): boolean {
  const t = date.getTime();
  if (start && t < start.getTime()) return false;
  // End bound is inclusive of the whole day's start; callers pass a date, and a
  // travel date equal to dateEnd is considered in-range.
  if (end && t > end.getTime()) return false;
  return true;
}

/**
 * Combine airline allow-lists across the rules that matched a supplier.
 *
 * An empty list on ANY matched rule means "all airlines" for that rule, which
 * widens the supplier to unrestricted (null). Otherwise the effective set is
 * the union of every matched rule's codes — each rule is an independent grant.
 */
function mergeAirlines(lists: string[][]): string[] | null {
  if (lists.length === 0) return null;
  if (lists.some((l) => l.length === 0)) return null;
  return Array.from(new Set(lists.flat()));
}

export function evaluateSupplierAccess(input: AccessInput): AccessDecision {
  const { productType, travelType, travelDate, agencyGroupIds, candidates, sources, maps } = input;
  const bypassAgency = input.bypassAgency ?? false;
  const callerGroups = new Set(agencyGroupIds);

  // Layer 2 config presence is evaluated PER supplier: a source allow-list only
  // gates a supplier that actually has source rows. A supplier with zero source
  // rows is not blocked by the source layer (fail-open for the unconfigured).
  const sourcesBySupplier = new Map<string, SourceRow[]>();
  for (const s of sources) {
    if (s.productType !== productType) continue;
    const list = sourcesBySupplier.get(s.supplierId) ?? [];
    list.push(s);
    sourcesBySupplier.set(s.supplierId, list);
  }

  // Layer 3/4 config presence is tenant+productType-wide: if ANY active map row
  // exists for this product type, the mapping layer switches to enforcement mode
  // for ALL suppliers. With no active rows we skip mapping+agency entirely.
  const activeMaps = maps.filter((m) => m.status === 'ACTIVE' && m.productType === productType);
  const mappingEnforced = activeMaps.length > 0;

  const decisions: SupplierDecision[] = candidates.map((c) => {
    // ── Layer 1: Supplier Active ──
    // A DB row that isn't ACTIVE is an explicit kill switch. No row → not gated
    // here (env-registered adapters like SERIES/MOCK have no Supplier row).
    if (c.status !== null && c.status !== 'ACTIVE') {
      return deny(c.code, 'SUPPLIER_INACTIVE');
    }

    // ── Layer 2: Source Active ──
    const supplierSources = c.supplierId ? (sourcesBySupplier.get(c.supplierId) ?? []) : [];
    let sourceAirlineLists: string[][] = [];
    if (supplierSources.length > 0) {
      const enabledMatching = supplierSources.filter(
        (s) => s.enabled && travelTypeMatches(s.travelType, travelType),
      );
      if (enabledMatching.length === 0) return deny(c.code, 'SOURCE_INACTIVE');
      sourceAirlineLists = enabledMatching.map((s) => s.airlineCodes ?? []);
    }

    // ── Layers 3 & 4: Mapping Allowed + Agency Authorized ──
    if (!mappingEnforced) {
      // Fail-open: no map configured for this product type → allow, carry only
      // the source-level airline restriction (if any).
      return allow(c.code, mergeAirlines(sourceAirlineLists), true);
    }

    // Rules that match this supplier on product/travel/date.
    const supplierMaps = activeMaps.filter((m) => {
      if (!travelTypeMatches(m.travelType, travelType)) return false;
      if (!dateInWindow(travelDate, m.dateStart, m.dateEnd)) return false;
      if (m.supplierIds.length > 0) {
        if (!c.supplierId || !m.supplierIds.includes(c.supplierId)) return false;
      }
      return true;
    });

    if (supplierMaps.length === 0) return deny(c.code, 'MAPPING_DENIED');

    // Layer 4: keep only rules whose agency-group scope includes the caller.
    const agencyMaps = bypassAgency
      ? supplierMaps
      : supplierMaps.filter(
          (m) => m.agencyGroupIds.length === 0 || m.agencyGroupIds.some((g) => callerGroups.has(g)),
        );

    if (agencyMaps.length === 0) return deny(c.code, 'AGENCY_DENIED');

    // Effective airline restriction = source restriction (if any) merged with
    // the matched mapping rules' restriction. Both are intersected: a result's
    // airline must satisfy whichever layers are restrictive.
    const mapAirlines = mergeAirlines(agencyMaps.map((m) => m.airlineCodes ?? []));
    const srcAirlines = mergeAirlines(sourceAirlineLists);
    const allowedAirlines = intersectAirlines(srcAirlines, mapAirlines);

    const allowPending = agencyMaps.some((m) => m.allowPendingBooking);
    return allow(c.code, allowedAirlines, allowPending);
  });

  const byCode: Record<string, SupplierDecision> = {};
  for (const d of decisions) byCode[d.code] = d;
  const allowedCodes = decisions.filter((d) => d.allowed).map((d) => d.code);
  return { decisions, allowedCodes, byCode };
}

function deny(code: string, reason: DenyLayer): SupplierDecision {
  return { code, allowed: false, reason, allowedAirlines: null, allowPendingBooking: false };
}

function allow(
  code: string,
  allowedAirlines: string[] | null,
  allowPendingBooking: boolean,
): SupplierDecision {
  return { code, allowed: true, reason: 'ALLOWED', allowedAirlines, allowPendingBooking };
}

/**
 * Intersect two airline allow-lists where null means "unrestricted".
 *   (null, null) → null
 *   (null, X)    → X
 *   (X, null)    → X
 *   (X, Y)       → X ∩ Y  (a fare must satisfy both restrictive layers)
 */
function intersectAirlines(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const setB = new Set(b);
  return a.filter((code) => setB.has(code));
}

/** True when a result's airline passes a decision's allow-list. */
export function airlineAllowed(decision: SupplierDecision, airlineCode: string): boolean {
  if (!decision.allowedAirlines) return true;
  return decision.allowedAirlines.includes(airlineCode.toUpperCase());
}
