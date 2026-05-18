// Cancellation policy string parser.
//
// SeatSeller returns a `cancellationPolicy` string on tripDetails that
// encodes a slab-based cancellation charge schedule. Format (no formal
// spec from RedBus — reverse-engineered from production samples):
//
//   "<slab1>|<slab2>|<slab3>..."
//
// Each slab is "fromHr:toHr:pct:absINR":
//
//   - fromHr  — hours BEFORE departure when this slab STARTS applying
//   - toHr    — hours BEFORE departure when this slab STOPS applying
//                (special: -1 means "any time before", i.e. no upper bound)
//   - pct     — percentage of base fare charged as cancellation fee
//   - absINR  — fixed absolute charge in rupees (additive on top of pct)
//
// Examples (real strings from SeatSeller fixtures):
//
//   "0:2:100:0|2:24:50:0|24:-1:10:0"
//      → cancel within 0-2h before dep   = 100% (non-cancellable)
//      → cancel within 2-24h before dep  = 50%
//      → cancel >24h before dep         = 10%
//
//   "0:24:100:0"   (single slab, only "non-cancellable in last 24h")
//      → cancel <24h before dep = 100%; >=24h is implicitly free
//
//   ""             → empty / absent → free cancellation always
//
// CLAUDE.md §12 edge cases (must all be handled):
//   - toHr = -1  →  "any time before"
//   - first slab fromHr > 0  →  inside that window is non-cancellable
//                                (treat as "no charge defined" — the booking
//                                service decides whether to allow user
//                                cancellation at all in that window)
//   - charge computed on **base fare only**, never total
//   - operatorServiceCharge is NON-refundable on user-initiated cancel,
//     refundable only on operator_cancelled. This module returns
//     baseFare-side numbers; the booking service composes OSC handling.
//
// Money convention: matches the rest of TripBNG — integer PAISE, no
// Decimal128. 1 INR = 100 paise. Math stays drift-free in integers.

/**
 * One slab in the cancellation schedule. Each slab covers a half-open
 * interval [fromHr, toHr) of "hours before departure". toHr=-1 means
 * "open-ended" (any time before).
 */
export interface CancellationSlab {
  fromHr: number;
  /** -1 means open-ended (no upper bound). */
  toHr: number;
  pct: number;
  /** Absolute charge in PAISE (the spec writes "absINR" but everywhere
   *  in this codebase money is paise; we name accordingly). */
  absPaise: number;
}

/**
 * Parse the SeatSeller policy string into a list of slabs.
 *
 * Returns an empty array when the input is empty / malformed. Caller
 * treats that as "free cancellation always". This is intentional —
 * we never throw from policy parsing because a malformed policy
 * shouldn't block the user from cancelling; it should fall back to
 * free-cancel and surface the issue in audit logs.
 *
 * Note: SeatSeller emits the absolute charge in RUPEES on the wire.
 * We convert to paise here so all downstream math is in paise.
 */
export function parsePolicy(raw: string | null | undefined): CancellationSlab[] {
  if (!raw || raw.trim().length === 0) return [];
  const slabs: CancellationSlab[] = [];
  for (const part of raw.split('|')) {
    const fields = part.split(':');
    if (fields.length !== 4) continue;
    const fromHr = Number.parseFloat(fields[0]!);
    const toHr = Number.parseFloat(fields[1]!);
    const pct = Number.parseFloat(fields[2]!);
    const absRupees = Number.parseFloat(fields[3]!);
    if (
      !Number.isFinite(fromHr) ||
      !Number.isFinite(toHr) ||
      !Number.isFinite(pct) ||
      !Number.isFinite(absRupees)
    ) {
      continue;
    }
    slabs.push({ fromHr, toHr, pct, absPaise: Math.round(absRupees * 100) });
  }
  // Sort by fromHr asc — `chargeFor` walks slabs in order and the
  // SeatSeller spec says they're emitted ordered, but defensive sort
  // protects against operator-side fixture drift.
  slabs.sort((a, b) => a.fromHr - b.fromHr);
  return slabs;
}

export interface ChargeResult {
  /** Cancellation fee (charge withheld from refund) in PAISE. */
  chargePaise: number;
  /** Net refund to wallet in paise. Always = baseFarePaise - chargePaise, never negative. */
  refundPaise: number;
  /** Which slab matched (or null if outside all slabs → free cancel). */
  matchedSlab: CancellationSlab | null;
}

/**
 * Compute the cancellation charge for a booking at a specific moment.
 * Spec-named signature kept for compatibility with CLAUDE.md §12 — but
 * without a known departure timestamp it can't actually resolve a slab.
 * Use chargeForAtDeparture in production.
 */
export function chargeFor(
  slabs: CancellationSlab[],
  _cancellationCalculationTs: Date,
  _cancelledAt: Date,
  baseFarePaise: number,
): ChargeResult {
  return {
    chargePaise: 0,
    refundPaise: Math.max(0, Math.round(baseFarePaise)),
    matchedSlab: null,
  };
}

/**
 * The real workhorse — resolves the slab against actual departure time.
 * Use this in the booking service.
 *
 * @param slabs            parsed slabs (output of parsePolicy)
 * @param cancelledAt      when the user clicked cancel
 * @param departureAt      the trip's departure instant (use ssMinutesToDate)
 * @param baseFarePaise    base fare per the booking record, in paise
 */
export function chargeForAtDeparture(
  slabs: CancellationSlab[],
  cancelledAt: Date,
  departureAt: Date,
  baseFarePaise: number,
): ChargeResult {
  const base = Math.max(0, Math.round(baseFarePaise));
  if (slabs.length === 0) {
    return { chargePaise: 0, refundPaise: base, matchedSlab: null };
  }

  const hoursBeforeDep = (departureAt.getTime() - cancelledAt.getTime()) / 3_600_000;
  // Already past departure → 100% charge (the bus has left). Match slab
  // with fromHr <= 0 (typically the "0:N:100:0" non-cancellable window).
  if (hoursBeforeDep <= 0) {
    const lastSlab = slabs.find((s) => s.fromHr <= 0) ?? slabs[0]!;
    return resultFor(lastSlab, base);
  }

  // Find the slab where fromHr <= hoursBeforeDep < toHr (toHr=-1 means open).
  for (const slab of slabs) {
    const inLower = slab.fromHr <= hoursBeforeDep;
    const inUpper = slab.toHr === -1 ? true : hoursBeforeDep < slab.toHr;
    if (inLower && inUpper) {
      return resultFor(slab, base);
    }
  }
  // No slab matched → cancellation is outside any window → free cancel.
  // (e.g. policy is "0:24:100:0" and user cancels 30h before departure.)
  return { chargePaise: 0, refundPaise: base, matchedSlab: null };
}

function resultFor(slab: CancellationSlab, basePaise: number): ChargeResult {
  // Charge = (pct% of base) + abs. Both components clamped to >=0.
  const pctCharge = Math.round((Math.max(0, slab.pct) / 100) * basePaise);
  const absCharge = Math.max(0, slab.absPaise);
  // Charge can't exceed the base fare — protects against operator-side
  // pct=120 quirks we've seen in fixtures.
  const charge = Math.min(basePaise, pctCharge + absCharge);
  const refund = Math.max(0, basePaise - charge);
  return { chargePaise: charge, refundPaise: refund, matchedSlab: slab };
}
