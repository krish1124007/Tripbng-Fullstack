// Pure quote resolver for admin-authored visa products.
//
// Same client-side resolution pattern as lib/holiday-quote.ts — runs off the
// priceMatrix already attached to the visa-product detail response, so the
// booking rail's live total updates without a network round-trip on every
// pax/urgent toggle. When server-side parity matters (quote PDF, audit log),
// this same function imports cleanly into apps/api.
//
// Algorithm (matches the prompt verbatim):
//   1. If priceMatrix.length > 0 and a row matches fromPax ≤ totalPax ≤ toPax,
//      use its consulate / service / urgent rates.
//   2. Otherwise use the product's base consulateFeeInr + serviceFeeInr (+ optional urgent surcharge).
//
// All amounts × pax → totalInr. 18% GST applied on the service-fee portion only
// (the consulate fee is pass-through to the mission, no tax).

import type { AdminVisaProduct, VisaPriceRow } from '@tripbng/shared';

export interface VisaQuoteSelection {
  /** Total applicants across ADT + CHD + INF — visa fees are typically per-head. */
  totalPax: number;
  urgent: boolean;
}

export interface VisaQuoteBreakdown {
  /** id of the matched matrix row, or null if base fees were used. */
  matchedRowId: string | null;
  matchedLabel: string | null;
  consulateFeePerPaxInr: number;
  serviceFeePerPaxInr: number;
  urgentSurchargePerPaxInr: number;
  consulateSubtotalInr: number;
  serviceSubtotalInr: number;
  urgentSubtotalInr: number;
  /** GST applied at 18% on the service subtotal only (consulate is pass-through). */
  gstInr: number;
  /** consulate + service + urgent + GST. */
  totalInr: number;
  totalPaise: number;
  /** Whether matrix path was hit (true) or base fees were used (false). */
  matrixHit: boolean;
}

const SERVICE_FEE_GST_RATE = 0.18;

export function quoteVisaProduct(
  product: AdminVisaProduct,
  selection: VisaQuoteSelection,
): VisaQuoteBreakdown {
  const pax = Math.max(0, selection.totalPax);
  const matched = matchRow(product.priceMatrix, pax);

  let consulatePerPax: number;
  let servicePerPax: number;
  let urgentPerPax: number;
  let matchedRowId: string | null;
  let matchedLabel: string | null;
  let matrixHit: boolean;

  if (matched) {
    consulatePerPax = matched.consulateFeeInr;
    servicePerPax = matched.serviceFeeInr;
    urgentPerPax = selection.urgent
      ? (matched.urgentSurchargeInr ?? product.urgentSurchargeInr ?? 0)
      : 0;
    matchedRowId = matched.id ?? null;
    matchedLabel = `${matched.fromPax}–${matched.toPax} pax · ${matched.priceType}`;
    matrixHit = true;
  } else {
    consulatePerPax = product.consulateFeeInr;
    servicePerPax = product.serviceFeeInr;
    urgentPerPax = selection.urgent ? (product.urgentSurchargeInr ?? 0) : 0;
    matchedRowId = null;
    matchedLabel = product.priceMatrix.length === 0 ? 'Base fee' : 'No matrix match — base fee';
    matrixHit = false;
  }

  const consulateSubtotal = consulatePerPax * pax;
  const serviceSubtotal = servicePerPax * pax;
  const urgentSubtotal = urgentPerPax * pax;
  const gst = Math.round(serviceSubtotal * SERVICE_FEE_GST_RATE);
  const total = consulateSubtotal + serviceSubtotal + urgentSubtotal + gst;

  return {
    matchedRowId,
    matchedLabel,
    consulateFeePerPaxInr: consulatePerPax,
    serviceFeePerPaxInr: servicePerPax,
    urgentSurchargePerPaxInr: urgentPerPax,
    consulateSubtotalInr: consulateSubtotal,
    serviceSubtotalInr: serviceSubtotal,
    urgentSubtotalInr: urgentSubtotal,
    gstInr: gst,
    totalInr: total,
    totalPaise: total * 100,
    matrixHit,
  };
}

function matchRow(matrix: VisaPriceRow[], totalPax: number): VisaPriceRow | null {
  if (matrix.length === 0 || totalPax < 1) return null;
  // Filter to Normal-priced rows that cover this pax band.
  const candidates = matrix
    .filter((r) => r.priceType === 'Normal')
    .filter((r) => r.fromPax <= totalPax && totalPax <= r.toPax);
  if (candidates.length === 0) return null;
  // Prefer the most-specific (narrowest) pax window.
  candidates.sort((a, b) => a.toPax - a.fromPax - (b.toPax - b.fromPax));
  return candidates[0] ?? null;
}
