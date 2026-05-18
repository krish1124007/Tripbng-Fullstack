// Corporate-policy gate for hotel offers + bookings.
//
// Two pure-function entry points:
//
//   filterOffersByPolicy(offers, policies, nights)
//     Drops offers that violate hard rules (per-night cap, refundable-only,
//     blocked chains, allowed-star-ratings filter). Returns {allowed, blocked}
//     so the caller can surface "X hidden by your travel policy" in the UI.
//
//   evaluateBookingGate({ totalSellingPaise, isRefundable, hotelName, hotelChain }, policies)
//     Decides whether a /book request should proceed straight to TBO ('allow'),
//     route to manager approval ('require_approval'), or be hard-rejected
//     ('block') for policy violations the search should have caught (defence
//     in depth).
//
// Both functions are pure — no DB, no I/O — so the unit tests in
// tbo-policy-guard.test.ts cover the matrix exhaustively.

import type { HotelOffer, HotelPolicies } from '@tripbng/shared';

export interface PolicyFilterResult {
  allowed: HotelOffer[];
  blocked: Array<{ offer: HotelOffer; reasons: PolicyViolation[] }>;
}

/** Distinct violation codes — for telemetry + UI explanations. */
export type PolicyViolation =
  | 'PER_NIGHT_CAP_EXCEEDED'
  | 'REFUNDABLE_ONLY'
  | 'BLOCKED_CHAIN'
  | 'STAR_RATING_NOT_ALLOWED'
  | 'TOTAL_OVER_APPROVAL_THRESHOLD';

export interface BookingGateInput {
  totalSellingPaise: number;
  isRefundable: boolean;
  hotelName: string;
  hotelChain: string | null;
  starRating: number | null;
  /** Pre-computed nights from check-in/check-out for the per-night cap check. */
  nights: number;
}

export interface BookingGateResult {
  /** allow → proceed to TBO Book.
   *  require_approval → persist AWAITING_APPROVAL, notify approver, no debit.
   *  block → hard-reject (policy violation that bypassed search). */
  gate: 'allow' | 'require_approval' | 'block';
  reasons: PolicyViolation[];
}

/**
 * Filter a list of offers against the agency's hotel policies. Returns
 * the allowed set + the blocked set with reason codes attached.
 */
export function filterOffersByPolicy(
  offers: HotelOffer[],
  policies: HotelPolicies,
  nights: number,
): PolicyFilterResult {
  const allowed: HotelOffer[] = [];
  const blocked: PolicyFilterResult['blocked'] = [];
  for (const offer of offers) {
    const reasons = checkOfferViolations(offer, policies, nights);
    if (reasons.length === 0) allowed.push(offer);
    else blocked.push({ offer, reasons });
  }
  return { allowed, blocked };
}

/**
 * Evaluate the booking gate for a single (already-policy-cleared on price-
 * insensitive rules) booking. Routes above-threshold bookings to approval.
 */
export function evaluateBookingGate(
  input: BookingGateInput,
  policies: HotelPolicies,
): BookingGateResult {
  const reasons: PolicyViolation[] = [];

  // Hard violations — search should have caught these but check again as
  // defence in depth (the offer the user picked may have come from a
  // direct-hotel request that bypassed search filters).
  if (
    policies.maxPerNightPaise != null &&
    input.nights > 0 &&
    Math.round(input.totalSellingPaise / input.nights) > policies.maxPerNightPaise
  ) {
    reasons.push('PER_NIGHT_CAP_EXCEEDED');
  }
  if (policies.refundableOnly && !input.isRefundable) {
    reasons.push('REFUNDABLE_ONLY');
  }
  if (input.hotelChain && policies.blockedChains.includes(input.hotelChain)) {
    reasons.push('BLOCKED_CHAIN');
  }
  if (
    input.starRating != null &&
    policies.allowedStarRatings.length > 0 &&
    !policies.allowedStarRatings.includes(input.starRating)
  ) {
    reasons.push('STAR_RATING_NOT_ALLOWED');
  }
  // Hard violations short-circuit to 'block' regardless of approval threshold.
  if (reasons.length > 0) return { gate: 'block', reasons };

  // Soft violation — total above approval threshold, route to manager.
  if (
    policies.requireApprovalAbovePaise != null &&
    input.totalSellingPaise > policies.requireApprovalAbovePaise
  ) {
    return {
      gate: 'require_approval',
      reasons: ['TOTAL_OVER_APPROVAL_THRESHOLD'],
    };
  }

  return { gate: 'allow', reasons: [] };
}

// ────────── helpers ──────────

function checkOfferViolations(
  offer: HotelOffer,
  policies: HotelPolicies,
  nights: number,
): PolicyViolation[] {
  const reasons: PolicyViolation[] = [];

  // Per-night cap — based on selling price.
  if (
    policies.maxPerNightPaise != null &&
    nights > 0 &&
    Math.round(offer.pricing.totalSellingPaise / nights) > policies.maxPerNightPaise
  ) {
    reasons.push('PER_NIGHT_CAP_EXCEEDED');
  }

  if (policies.refundableOnly && !offer.policies.isRefundable) {
    reasons.push('REFUNDABLE_ONLY');
  }

  // Chain match is best-effort: TBO doesn't always return a parent-brand
  // field. We do a substring match on the hotel name as a heuristic — good
  // enough for "block all OYO" / "prefer Marriott" type rules.
  if (policies.blockedChains.length > 0) {
    const lcName = offer.hotel.name.toLowerCase();
    if (policies.blockedChains.some((chain: string) => lcName.includes(chain.toLowerCase()))) {
      reasons.push('BLOCKED_CHAIN');
    }
  }

  if (
    offer.hotel.starRating != null &&
    policies.allowedStarRatings.length > 0 &&
    !policies.allowedStarRatings.includes(offer.hotel.starRating)
  ) {
    reasons.push('STAR_RATING_NOT_ALLOWED');
  }

  return reasons;
}

/**
 * Convert a partial Agency.hotelPolicies subdoc (which may have null/missing
 * sub-fields on legacy rows) into a fully-populated HotelPolicies struct
 * with safe defaults. Used by services that read agencies via .lean() and
 * need to normalise before passing to the pure-function helpers above.
 *
 * Input is `unknown`-typed because Mongoose's lean() returns ObjectId for
 * defaultApproverUserId but the shared HotelPolicies type expects string —
 * we coerce here so the call sites stay clean.
 */
export function normalizePolicies(raw: unknown | null | undefined): HotelPolicies {
  const r = (raw ?? {}) as Partial<HotelPolicies> & {
    defaultApproverUserId?: { toString(): string } | string | null;
  };
  const approver = r.defaultApproverUserId;
  return {
    maxPerNightPaise: r.maxPerNightPaise ?? null,
    refundableOnly: r.refundableOnly ?? false,
    preferredChains: r.preferredChains ?? [],
    blockedChains: r.blockedChains ?? [],
    allowedStarRatings: r.allowedStarRatings ?? [],
    requireApprovalAbovePaise: r.requireApprovalAbovePaise ?? null,
    defaultApproverUserId:
      approver == null ? null : typeof approver === 'string' ? approver : String(approver),
    markupPercent: r.markupPercent ?? null,
  };
}
