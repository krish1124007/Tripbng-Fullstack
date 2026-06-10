// Map Policy pricing — Phase 8 of the admin panel spec.
//
// Layers the MapPolicy components on top of the existing pricing engine
// output as a post-processor. The Phase-2 engine (priceFare) keeps its
// existing behaviour; this service adjusts the already-priced FareBreakdown
// based on the matching MapPolicy.
//
// Semantics
// ---------
// commission / plb (payout components, both reference a "% of supplier
//   commission"):
//   agentDiscount = round(supplierCommission × payoutPercent / 100)
//   supplierCommission is the platform's share of the supplier remit,
//   computed by the Phase-2 engine as
//     supplierCommission = round(baseFare × Policy.commissionPercent / 10000)
//   The Phase-2 engine doesn't surface that number separately; we recompute
//   it here from `baseFarePaise` + the same Policy doc the option's policyId
//   points at. If no Policy is attached, commission/PLB are no-ops (we
//   have no commission base to share).
//
//   Effect on the FareBreakdown:
//     grossAmountPaise    -= agentDiscount
//     agencyPayablePaise  -= agentDiscount
//     platformEarningsPaise -= agentDiscount
//     discountPaise       += agentDiscount   (so the booking shows the
//                                             agent-facing line item)
//
// b2bMarkup (fee component, value can be ABSOLUTE or PERCENT):
//   addOn = ABSOLUTE  → value paise
//   addOn = PERCENT   → round((baseFare + taxes) × value / 100)
//   grossAmountPaise    += addOn
//   agencyPayablePaise  += addOn
//   policyAdjustmentPaise += addOn
//   platformEarningsPaise += addOn   (platform retains the markup)
//
// managementFee (same shape as b2bMarkup; `hideFromAgent` is a presentation
//   hint — totals still reflect the fee). Same arithmetic; the trace step
//   carries `hidden: true` when hideFromAgent is set so the booking UI can
//   suppress the line item but the math doesn't change.
//
// Match semantics for criteria.mapSourceIds
// -----------------------------------------
// A policy with `criteria.mapSourceIds = [src1, src2, …]` matches a booking
// only when the booking's supplier is the same as the supplier of at least
// one of those Map Sources. The check requires the caller to pass
// `supplierCode` on the resolver input; legacy callers that omit it skip
// the criterion entirely (back-compat — the resolver never used to know
// the supplier).
//
// Match semantics for criteria.fareTypes
// --------------------------------------
// The caller passes the BEST fare-type signal it has: prefer
// NormalizedFareOption.fareType (real airline-marketed label) and fall back
// to fareClass (supplier booking-class code) when an adapter doesn't surface
// the marketing label. Existing configs that pasted booking-class codes
// into criteria.fareTypes keep matching against the fareClass fallback.

import type { FareBreakdown } from '@tripbng/shared';
import { MapPolicy, type MapPolicyDoc } from '../../models/MapPolicy.js';
import { Policy } from '../../models/Policy.js';
import { Supplier } from '../../models/Supplier.js';
import { SupplierSource } from '../../models/SupplierSource.js';
import { logger } from '../../config/logger.js';

export interface ResolveMapPolicyInput {
  tenantId: string;
  productType: 'FLIGHT' | 'HOTEL' | 'BUS' | 'VISA';
  airline: string;
  fareType: string | null | undefined;
  agencyGroupIds: string[];
  /** Supplier code from the search result, e.g. "KAFILA". When provided,
   *  policies with `criteria.mapSourceIds` are filtered to those whose
   *  referenced Map Sources belong to this supplier. When absent, the
   *  mapSourceIds criterion is ignored (legacy / safe-default behaviour
   *  documented in Phase 8's V1-limitations notes). */
  supplierCode?: string | null;
}

/**
 * Find the highest-priority active MapPolicy that matches this booking
 * shape. Returns null when nothing matches — callers should pass-through.
 */
export async function resolveMapPolicy(
  input: ResolveMapPolicyInput,
): Promise<MapPolicyDoc | null> {
  // Coarse Mongo filter on the indexed fields; we narrow further in JS
  // because the array-intersection + emptiness semantics are awkward to
  // express in a single query.
  const candidates = (await MapPolicy.find({
    tenantId: input.tenantId,
    status: 'ACTIVE',
    productType: input.productType,
  })
    .sort({ priority: 1, createdAt: -1 })
    .lean()) as unknown as MapPolicyDoc[];

  if (candidates.length === 0) return null;

  const airline = input.airline.toUpperCase();
  const fareType = input.fareType?.toLowerCase() ?? null;
  const agencyGroupSet = new Set(input.agencyGroupIds);

  // Pre-flight: if the supplierCode is known and any candidate policy has
  // criteria.mapSourceIds set, resolve the supplier_id for this booking
  // and the supplier_ids each referenced Map Source belongs to — once,
  // up-front. Avoids N+1 lookups inside the per-candidate loop.
  let bookingSupplierIdStr: string | null = null;
  const mapSourceToSupplierId: Map<string, string> = new Map();
  const candidatesWithSourceFilter = candidates.filter((p) => {
    const ids = ((p as unknown as { criteria?: { mapSourceIds?: unknown[] } })
      .criteria?.mapSourceIds ?? []) as Array<{ toString(): string }>;
    return ids.length > 0;
  });
  if (input.supplierCode && candidatesWithSourceFilter.length > 0) {
    const supplier = await Supplier.findOne({
      tenantId: input.tenantId,
      code: input.supplierCode,
    })
      .select({ _id: 1 })
      .lean();
    bookingSupplierIdStr = supplier?._id.toString() ?? null;

    const allMapSourceIds = Array.from(
      new Set(
        candidatesWithSourceFilter.flatMap((p) =>
          (
            ((p as unknown as { criteria?: { mapSourceIds?: Array<{ toString(): string }> } })
              .criteria?.mapSourceIds ?? [])
          ).map((id) => id.toString()),
        ),
      ),
    );
    const sources = await SupplierSource.find({
      _id: { $in: allMapSourceIds },
      tenantId: input.tenantId,
    })
      .select({ _id: 1, supplierId: 1 })
      .lean();
    for (const s of sources) {
      mapSourceToSupplierId.set(s._id.toString(), s.supplierId.toString());
    }
  }

  for (const p of candidates) {
    const c = (p as unknown as { criteria?: Record<string, unknown> }).criteria ?? {};
    const airlines = ((c.airlineCodes as string[] | undefined) ?? []).map((x) =>
      x.toUpperCase(),
    );
    if (airlines.length > 0 && !airlines.includes(airline)) continue;

    const fareTypes = ((c.fareTypes as string[] | undefined) ?? []).map((x) =>
      x.toLowerCase(),
    );
    if (fareTypes.length > 0) {
      // No fareType on the option → can't match a policy that's gated on
      // specific fare types. Pass to the next candidate.
      if (!fareType || !fareTypes.includes(fareType)) continue;
    }

    const groups = ((c.agencyGroupIds as Array<{ toString(): string }> | undefined) ?? []).map(
      (g) => g.toString(),
    );
    if (groups.length > 0 && !groups.some((g) => agencyGroupSet.has(g))) continue;

    // mapSourceIds — when set, match only when the booking's supplier owns
    // at least one of the referenced Map Sources. Legacy callers that don't
    // pass `supplierCode` skip the criterion entirely (back-compat — the
    // resolver never used to know the supplier; flipping to strict-deny
    // would silently drop matches for any caller that hasn't been updated).
    const mapSourceIds = ((c.mapSourceIds as Array<{ toString(): string }> | undefined) ?? []).map(
      (id) => id.toString(),
    );
    if (mapSourceIds.length > 0 && input.supplierCode && bookingSupplierIdStr) {
      const allowedSupplierIds = new Set(
        mapSourceIds.map((id) => mapSourceToSupplierId.get(id)).filter((v): v is string => Boolean(v)),
      );
      if (!allowedSupplierIds.has(bookingSupplierIdStr)) continue;
    }

    return p;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Application
// ─────────────────────────────────────────────────────────────────────────────

export interface MapPolicyTraceStep {
  step: string;
  /** Component this step represents — useful for UI grouping. */
  component: 'commission' | 'plb' | 'b2bMarkup' | 'managementFee';
  /** Negative for agent discounts; positive for agent charges. */
  deltaPaise: number;
  /** Snapshot before this step. */
  grossBeforePaise: number;
  /** Snapshot after this step. */
  grossAfterPaise: number;
  /** Management fee carries `hidden: true` when hideFromAgent is set. */
  hidden?: boolean;
  /** Human label — e.g. "70% PASS" or "IDRS". */
  ruleName?: string | null;
}

export interface MapPolicyApplyResult {
  /** The adjusted breakdown. Same shape as the input. */
  breakdown: FareBreakdown;
  /** Per-component trace steps. Empty when the policy was a no-op. */
  trace: MapPolicyTraceStep[];
  /** Sum of agent-facing deltas. Negative = agent saved; positive = agent
   *  paid more. */
  totalDeltaPaise: number;
}

/**
 * Apply one MapPolicy's enabled components to a single pax's
 * FareBreakdown. Pure — same input → same output. The supplierCommission
 * argument lets the caller compute it once per fare option (it's the same
 * for all pax types) and pass it in for every pax breakdown.
 */
export function applyMapPolicyToBreakdown(
  breakdown: FareBreakdown,
  policy: MapPolicyDoc,
  opts: { supplierCommissionPaise: number },
): MapPolicyApplyResult {
  const trace: MapPolicyTraceStep[] = [];
  let totalDelta = 0;

  let grossAmountPaise = breakdown.grossAmountPaise;
  let agencyPayablePaise = breakdown.agencyPayablePaise;
  let platformEarningsPaise = breakdown.platformEarningsPaise;
  let discountPaise = breakdown.discountPaise;
  let policyAdjustmentPaise = breakdown.policyAdjustmentPaise;

  const p = policy as unknown as {
    name?: string;
    commission?: { enabled?: boolean; name?: string | null; payoutPercent?: number };
    plb?: { enabled?: boolean; name?: string | null; payoutPercent?: number };
    b2bMarkup?: {
      enabled?: boolean;
      name?: string | null;
      valueType?: 'ABSOLUTE' | 'PERCENT';
      value?: number;
    };
    managementFee?: {
      enabled?: boolean;
      name?: string | null;
      valueType?: 'ABSOLUTE' | 'PERCENT';
      value?: number;
      hideFromAgent?: boolean;
    };
  };

  // ── Commission pass-through ────────────────────────────────────────────────
  if (p.commission?.enabled && opts.supplierCommissionPaise > 0) {
    const pct = p.commission.payoutPercent ?? 0;
    const agentDiscount = Math.round((opts.supplierCommissionPaise * pct) / 100);
    if (agentDiscount > 0) {
      const before = grossAmountPaise;
      grossAmountPaise -= agentDiscount;
      agencyPayablePaise -= agentDiscount;
      platformEarningsPaise -= agentDiscount;
      discountPaise += agentDiscount;
      totalDelta -= agentDiscount;
      trace.push({
        step: 'map-policy.commission',
        component: 'commission',
        deltaPaise: -agentDiscount,
        grossBeforePaise: before,
        grossAfterPaise: grossAmountPaise,
        ruleName: p.commission.name ?? null,
      });
    }
  }

  // ── PLB pass-through (same math as commission, shares the commission pool) ─
  if (p.plb?.enabled && opts.supplierCommissionPaise > 0) {
    const pct = p.plb.payoutPercent ?? 0;
    const agentDiscount = Math.round((opts.supplierCommissionPaise * pct) / 100);
    if (agentDiscount > 0) {
      const before = grossAmountPaise;
      grossAmountPaise -= agentDiscount;
      agencyPayablePaise -= agentDiscount;
      platformEarningsPaise -= agentDiscount;
      discountPaise += agentDiscount;
      totalDelta -= agentDiscount;
      trace.push({
        step: 'map-policy.plb',
        component: 'plb',
        deltaPaise: -agentDiscount,
        grossBeforePaise: before,
        grossAfterPaise: grossAmountPaise,
        ruleName: p.plb.name ?? null,
      });
    }
  }

  // ── B2B Markup (add to fare) ───────────────────────────────────────────────
  if (p.b2bMarkup?.enabled) {
    const value = p.b2bMarkup.value ?? 0;
    const baseForPercent = breakdown.baseFarePaise + breakdown.taxesPaise;
    const addOn =
      p.b2bMarkup.valueType === 'PERCENT'
        ? Math.round((baseForPercent * value) / 100)
        : value;
    if (addOn > 0) {
      const before = grossAmountPaise;
      grossAmountPaise += addOn;
      agencyPayablePaise += addOn;
      platformEarningsPaise += addOn;
      policyAdjustmentPaise += addOn;
      totalDelta += addOn;
      trace.push({
        step: 'map-policy.b2bMarkup',
        component: 'b2bMarkup',
        deltaPaise: addOn,
        grossBeforePaise: before,
        grossAfterPaise: grossAmountPaise,
        ruleName: p.b2bMarkup.name ?? null,
      });
    }
  }

  // ── Management Fee (add to fare; hideFromAgent is presentation-only) ──────
  if (p.managementFee?.enabled) {
    const value = p.managementFee.value ?? 0;
    const baseForPercent = breakdown.baseFarePaise + breakdown.taxesPaise;
    const addOn =
      p.managementFee.valueType === 'PERCENT'
        ? Math.round((baseForPercent * value) / 100)
        : value;
    if (addOn > 0) {
      const before = grossAmountPaise;
      grossAmountPaise += addOn;
      agencyPayablePaise += addOn;
      platformEarningsPaise += addOn;
      policyAdjustmentPaise += addOn;
      totalDelta += addOn;
      trace.push({
        step: 'map-policy.managementFee',
        component: 'managementFee',
        deltaPaise: addOn,
        grossBeforePaise: before,
        grossAfterPaise: grossAmountPaise,
        hidden: p.managementFee.hideFromAgent ?? false,
        ruleName: p.managementFee.name ?? null,
      });
    }
  }

  return {
    breakdown: {
      ...breakdown,
      grossAmountPaise,
      agencyPayablePaise,
      platformEarningsPaise,
      discountPaise,
      policyAdjustmentPaise,
    },
    trace,
    totalDeltaPaise: totalDelta,
  };
}

/**
 * Convenience: resolve the supplier commission base from an existing Policy
 * id (the one the search-result option carries). Returns 0 when no policy
 * attached or commissionPercent is 0 — which makes commission/PLB no-ops
 * downstream. Cached per request via the optional `cache` map so we don't
 * re-query for every option that shares a policyId.
 */
export async function resolveSupplierCommissionPaise(
  policyId: string | null | undefined,
  baseFarePaise: number,
  cache?: Map<string, number>,
): Promise<number> {
  if (!policyId || baseFarePaise <= 0) return 0;
  if (cache?.has(policyId)) {
    return Math.round((baseFarePaise * cache.get(policyId)!) / 10000);
  }
  const policy = await Policy.findById(policyId).select('commissionPercent').lean();
  const commissionPercent = policy?.commissionPercent ?? 0;
  if (cache) cache.set(policyId, commissionPercent);
  if (commissionPercent <= 0) return 0;
  // commissionPercent is basis points × 100 (per existing engine convention).
  return Math.round((baseFarePaise * commissionPercent) / 10000);
}

/**
 * Log helper — emits a single structured line summarising what the policy
 * did to this fare option. Called by the search service after applying.
 */
export function logMapPolicyApplied(
  policy: MapPolicyDoc,
  totalDeltaPaise: number,
  context: { fareId: string; airline: string; tenantId: string },
): void {
  logger.debug(
    {
      mapPolicyId: String((policy as unknown as { _id: { toString(): string } })._id),
      mapPolicyName: (policy as unknown as { name?: string }).name,
      fareId: context.fareId,
      airline: context.airline,
      tenantId: context.tenantId,
      totalDeltaPaise,
    },
    'map-policy applied to fare',
  );
}
