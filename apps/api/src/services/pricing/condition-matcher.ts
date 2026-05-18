import type { PricingInput, PricingMarkupRule } from './types.js';

// Rule conditions are AND'd together — every populated condition field must match.
// An empty/undefined field matches anything (i.e. no constraint).
// This is the canonical place to evolve matching logic; pricing pipeline composes from here.
export function matchesConditions(rule: PricingMarkupRule, input: PricingInput): boolean {
  if (rule.status !== 'ACTIVE') return false;

  // Scope-bound rules must target the right entity. PLATFORM rules apply to everyone.
  if (rule.scope === 'DISTRIBUTOR') {
    if (!input.distributorId || rule.distributorId !== input.distributorId) return false;
  }
  if (rule.scope === 'AGENCY') {
    if (rule.agencyId !== input.agencyId) return false;
  }

  const c = rule.conditions ?? {};

  if (c.airlines && c.airlines.length > 0 && !c.airlines.includes(input.airline)) return false;
  if (c.travelType && c.travelType !== input.travelType) return false;
  if (c.travelClass && c.travelClass !== input.travelClass) return false;
  if (c.paxTypes && c.paxTypes.length > 0 && !c.paxTypes.includes(input.paxType)) return false;
  if (c.origins && c.origins.length > 0 && !c.origins.includes(input.origin)) return false;
  if (c.destinations && c.destinations.length > 0 && !c.destinations.includes(input.destination))
    return false;
  if (c.fareClasses && c.fareClasses.length > 0) {
    if (!input.fareClass || !c.fareClasses.includes(input.fareClass)) return false;
  }
  if (c.agencyGroupIds && c.agencyGroupIds.length > 0) {
    const buyerGroups = input.agencyGroupIds ?? [];
    if (!c.agencyGroupIds.some((g) => buyerGroups.includes(g))) return false;
  }

  const now = input.bookingDate ?? new Date();
  if (c.effectiveFrom && now < new Date(c.effectiveFrom)) return false;
  if (c.effectiveTo && now > new Date(c.effectiveTo)) return false;

  return true;
}

// Pick the highest-priority (lowest number) matching rule per scope. Returns up to one per scope.
export function pickRulesByScope(
  rules: readonly PricingMarkupRule[],
  input: PricingInput,
): { platform?: PricingMarkupRule; distributor?: PricingMarkupRule; agency?: PricingMarkupRule } {
  const out: ReturnType<typeof pickRulesByScope> = {};
  const matching = rules.filter((r) => matchesConditions(r, input));
  for (const scope of ['PLATFORM', 'DISTRIBUTOR', 'AGENCY'] as const) {
    const inScope = matching.filter((r) => r.scope === scope);
    if (inScope.length === 0) continue;
    inScope.sort((a, b) => a.priority - b.priority);
    const winner = inScope[0];
    if (winner) {
      if (scope === 'PLATFORM') out.platform = winner;
      if (scope === 'DISTRIBUTOR') out.distributor = winner;
      if (scope === 'AGENCY') out.agency = winner;
    }
  }
  return out;
}

// Compute the markup amount in paise. PERCENT uses basis-points-times-100 so we divide by 10000.
// maxValuePaise caps the result for runaway percentage rules.
export function computeMarkupPaise(rule: PricingMarkupRule, basePaise: number): number {
  let amount: number;
  if (rule.valueType === 'FLAT') {
    amount = rule.value;
  } else {
    // basis points × 100 → divide by 10000 to get the multiplier; round half-away-from-zero.
    amount = Math.round((basePaise * rule.value) / 10000);
  }
  if (rule.maxValuePaise != null && amount > rule.maxValuePaise) {
    amount = rule.maxValuePaise;
  }
  return Math.max(0, amount);
}
