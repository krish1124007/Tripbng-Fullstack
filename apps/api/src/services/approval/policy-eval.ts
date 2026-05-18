// Travel-policy evaluation — pure functions.
//
// One entry point: `evaluateBusPolicy(trip, seat, policy)`. The function
// runs every rule in spec §10 order and returns either { ok: true } or
// a list of human-readable violation strings. A successful evaluation
// can still ask for manager approval (via `requiresApproval`) when fare
// exceeds the configured threshold.
//
// Pure: no DB, no clock except an injectable `now` for testing. Callers
// (search service, approval submit) compose this with their own data
// loads.
//
// Shape of inputs is intentionally narrow — only the fields the rules
// actually look at. Keeps the function easy to wire from search trip
// views, the booking form, and the approval submit endpoint without
// each caller having to reshape their data.

export interface PolicyEvalTrip {
  /** SeatSeller numeric busTypeId — required for the allowedBusTypeIds rule. */
  busTypeId?: number;
  /** SeatSeller numeric operatorId. */
  operatorId: number;
  /** Whether this trip is an A/C bus. Trip details usually surfaces this;
   *  if absent, the AC rule treats it as "unknown" → fails the check. */
  isAc?: boolean;
  /** Whether this is a sleeper class. */
  isSleeper?: boolean;
  /** ISO-resolved departure timestamp — we compute hours-from-now off this. */
  departureAt: string | Date;
}

export interface PolicyEvalSeat {
  /** Per-pax fare for the chosen seat, in paise. */
  farePaise: number;
}

export interface PolicyEvalRulesBus {
  maxFarePaise?: number | null;
  acOnly?: boolean;
  sleeperAllowed?: boolean;
  minAdvanceHours?: number;
  maxAdvanceDays?: number;
  allowedBusTypeIds?: number[] | null;
  blockedOperatorIds?: number[] | null;
  requireApprovalAbovePaise?: number | null;
}

export interface PolicyEvalContext {
  rules: { bus?: PolicyEvalRulesBus | null } | null;
  /** Auto-approval threshold (paise). null/undefined = no auto-approval. */
  autoApproveBelowPaise?: number | null;
}

export interface PolicyEvalResult {
  /** True when ALL hard rules pass. False = booking is blocked outright. */
  ok: boolean;
  /** Human-readable reasons. Surfaced to the employee on the search/seat
   *  picker UI ("requires approval", "above max fare", …). */
  violations: string[];
  /** Whether the request must go through a manager. Independent of `ok`:
   *  - `ok=true && requiresApproval=false` → free to book
   *  - `ok=true && requiresApproval=true`  → submit ApprovalRequest
   *  - `ok=false`                          → block, surface violations,
   *                                          submission still possible
   *                                          but the manager must
   *                                          override. */
  requiresApproval: boolean;
  /** True when fare ≤ autoApproveBelowPaise — the approval service
   *  auto-marks the request as `approved` on submit. Independent of
   *  `requiresApproval`; only meaningful when `ok=true`. */
  autoApproveEligible: boolean;
}

/**
 * Evaluate a (trip, seat) pair against a policy. Pure function — no
 * I/O, deterministic for the same inputs + `now`.
 *
 * @param trip    PolicyEvalTrip — narrow view of the trip the user picked
 * @param seat    PolicyEvalSeat — the seat / fare they want
 * @param ctx     PolicyEvalContext — { rules.bus, autoApproveBelowPaise }
 * @param now     Reference instant — defaults to `new Date()`. Tests
 *                pass a fixed Date for deterministic behaviour.
 */
export function evaluateBusPolicy(
  trip: PolicyEvalTrip,
  seat: PolicyEvalSeat,
  ctx: PolicyEvalContext,
  now: Date = new Date(),
): PolicyEvalResult {
  const violations: string[] = [];
  const rules = ctx.rules?.bus ?? null;

  // No policy attached — permissive. Spec calls this out as the
  // "tenant hasn't configured a policy yet" baseline.
  if (!rules) {
    return finaliseOk({ violations, ctx, seat });
  }

  // ── 1. Booking-window guards ──
  const departureAt = toDate(trip.departureAt);
  const hoursFromNow = (departureAt.getTime() - now.getTime()) / 3_600_000;
  const minAdvanceHours = rules.minAdvanceHours ?? 0;
  const maxAdvanceDays = rules.maxAdvanceDays ?? 365;
  if (hoursFromNow < minAdvanceHours) {
    violations.push(
      `Departure must be at least ${minAdvanceHours}h away (currently ${formatHours(hoursFromNow)} from now).`,
    );
  }
  if (hoursFromNow > maxAdvanceDays * 24) {
    violations.push(
      `Bookings allowed up to ${maxAdvanceDays} days in advance; this is ${Math.ceil(hoursFromNow / 24)} days out.`,
    );
  }

  // ── 2. Fare cap ──
  if (rules.maxFarePaise != null && seat.farePaise > rules.maxFarePaise) {
    violations.push(
      `Fare ${formatRupees(seat.farePaise)} exceeds max ${formatRupees(rules.maxFarePaise)}.`,
    );
  }

  // ── 3. AC-only ──
  if (rules.acOnly === true && trip.isAc !== true) {
    violations.push('Policy allows AC buses only.');
  }

  // ── 4. Sleeper allowance ──
  if (rules.sleeperAllowed === false && trip.isSleeper === true) {
    violations.push('Sleeper buses are not allowed under this policy.');
  }

  // ── 5. busType whitelist ──
  if (
    rules.allowedBusTypeIds &&
    rules.allowedBusTypeIds.length > 0 &&
    trip.busTypeId !== undefined &&
    !rules.allowedBusTypeIds.includes(trip.busTypeId)
  ) {
    violations.push(`Bus type ${trip.busTypeId} is not on the allowed list.`);
  }

  // ── 6. operator blacklist ──
  if (
    rules.blockedOperatorIds &&
    rules.blockedOperatorIds.length > 0 &&
    rules.blockedOperatorIds.includes(trip.operatorId)
  ) {
    violations.push(`Operator ${trip.operatorId} is on the blocked list.`);
  }

  const ok = violations.length === 0;

  // ── 7. Approval-required-above threshold ──
  // This is independent of `ok`: a fare-based approval kicks in even when
  // the rest of the policy is satisfied. The booking flow still creates
  // the ApprovalRequest in `pending` (or auto-approved if eligible).
  const requiresApproval =
    rules.requireApprovalAbovePaise != null && seat.farePaise > rules.requireApprovalAbovePaise;

  if (!ok) {
    return {
      ok: false,
      violations,
      requiresApproval,
      autoApproveEligible: false,
    };
  }

  return finaliseOk({ violations, ctx, seat, requiresApproval });
}

function finaliseOk(input: {
  violations: string[];
  ctx: PolicyEvalContext;
  seat: PolicyEvalSeat;
  requiresApproval?: boolean;
}): PolicyEvalResult {
  const auto =
    input.ctx.autoApproveBelowPaise != null && input.seat.farePaise <= input.ctx.autoApproveBelowPaise;
  return {
    ok: true,
    violations: input.violations,
    requiresApproval: input.requiresApproval ?? false,
    autoApproveEligible: auto,
  };
}

function toDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) {
    // Anything we can't parse is treated as the epoch — that will
    // always violate min/max advance rules. Surfaces as a clear
    // policy violation rather than a silent crash.
    return new Date(0);
  }
  return parsed;
}

function formatHours(h: number): string {
  if (h < 0) return `-${formatHours(-h)}`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
