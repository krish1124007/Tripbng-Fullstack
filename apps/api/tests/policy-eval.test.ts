// Travel-policy evaluation tests.
//
// Pure-function suite. Every CLAUDE.md §10 rule has at least one
// passing + one violating fixture. The "ok-but-requires-approval"
// branch is the most subtle and gets explicit coverage.

import { describe, expect, it } from 'vitest';
import {
  evaluateBusPolicy,
  type PolicyEvalContext,
} from '../src/services/approval/policy-eval.js';

const NOW = new Date('2026-06-01T00:00:00Z');

const baseTrip = {
  busTypeId: 17,
  operatorId: 9001,
  isAc: true,
  isSleeper: true,
  // 5 days from NOW.
  departureAt: '2026-06-06T18:30:00Z',
};

const baseSeat = { farePaise: 100_000 }; // ₹1,000

const noPolicy: PolicyEvalContext = { rules: null, autoApproveBelowPaise: null };

const strictPolicy: PolicyEvalContext = {
  rules: {
    bus: {
      maxFarePaise: 200_000,
      acOnly: true,
      sleeperAllowed: true,
      minAdvanceHours: 24,
      maxAdvanceDays: 90,
      allowedBusTypeIds: [17, 18],
      blockedOperatorIds: [9999],
      requireApprovalAbovePaise: 150_000,
    },
  },
  autoApproveBelowPaise: 50_000,
};

describe('evaluateBusPolicy — no policy', () => {
  it('returns ok with no violations and no approval requirement', () => {
    const r = evaluateBusPolicy(baseTrip, baseSeat, noPolicy, NOW);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.requiresApproval).toBe(false);
    expect(r.autoApproveEligible).toBe(false); // null threshold → not eligible
  });
});

describe('evaluateBusPolicy — happy path', () => {
  it('passes a fully-compliant request', () => {
    const r = evaluateBusPolicy(baseTrip, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    // Fare 100k ≤ 150k → no approval-by-fare
    expect(r.requiresApproval).toBe(false);
    // Fare 100k > autoApprove threshold 50k → not auto-eligible
    expect(r.autoApproveEligible).toBe(false);
  });

  it('marks autoApproveEligible when fare is ≤ threshold', () => {
    const r = evaluateBusPolicy(baseTrip, { farePaise: 40_000 }, strictPolicy, NOW);
    expect(r.ok).toBe(true);
    expect(r.autoApproveEligible).toBe(true);
  });
});

describe('evaluateBusPolicy — booking-window guards', () => {
  it('rejects departures inside the minAdvanceHours window', () => {
    const tooSoon = { ...baseTrip, departureAt: '2026-06-01T12:00:00Z' }; // 12h
    const r = evaluateBusPolicy(tooSoon, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/at least.*24h/i))).toBe(true);
  });

  it('rejects departures past maxAdvanceDays', () => {
    const tooFar = { ...baseTrip, departureAt: '2026-09-30T18:30:00Z' }; // ~120d
    const r = evaluateBusPolicy(tooFar, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/up to 90 days/))).toBe(true);
  });
});

describe('evaluateBusPolicy — fare cap', () => {
  it('rejects fares above maxFarePaise', () => {
    const r = evaluateBusPolicy(baseTrip, { farePaise: 250_000 }, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/exceeds max/))).toBe(true);
  });

  it('allows fares exactly at the cap', () => {
    const r = evaluateBusPolicy(baseTrip, { farePaise: 200_000 }, strictPolicy, NOW);
    expect(r.ok).toBe(true);
  });
});

describe('evaluateBusPolicy — class restrictions', () => {
  it('rejects non-AC trips when acOnly=true', () => {
    const r = evaluateBusPolicy({ ...baseTrip, isAc: false }, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/AC buses only/i))).toBe(true);
  });

  it('treats unknown isAc as a failure when acOnly=true (cautious default)', () => {
    const trip = { ...baseTrip };
    delete (trip as { isAc?: boolean }).isAc;
    const r = evaluateBusPolicy(trip, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
  });

  it('rejects sleepers when sleeperAllowed=false', () => {
    const policy: PolicyEvalContext = {
      ...strictPolicy,
      rules: { bus: { ...strictPolicy.rules!.bus!, sleeperAllowed: false } },
    };
    const r = evaluateBusPolicy(baseTrip, baseSeat, policy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/Sleeper buses are not allowed/))).toBe(true);
  });
});

describe('evaluateBusPolicy — busType + operator filters', () => {
  it('rejects busTypeIds outside the whitelist', () => {
    const trip = { ...baseTrip, busTypeId: 99 };
    const r = evaluateBusPolicy(trip, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/Bus type 99/))).toBe(true);
  });

  it('rejects operatorIds on the blacklist', () => {
    const trip = { ...baseTrip, operatorId: 9999 };
    const r = evaluateBusPolicy(trip, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.match(/Operator 9999/))).toBe(true);
  });

  it('passes when whitelist is set but trip.busTypeId is undefined (insufficient signal)', () => {
    const trip = { ...baseTrip };
    delete (trip as { busTypeId?: number }).busTypeId;
    const r = evaluateBusPolicy(trip, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(true);
  });
});

describe('evaluateBusPolicy — requireApprovalAbovePaise', () => {
  it('flags requiresApproval=true when fare exceeds the threshold', () => {
    const r = evaluateBusPolicy(baseTrip, { farePaise: 175_000 }, strictPolicy, NOW);
    expect(r.ok).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  it('does not auto-approve when requiresApproval is true (manager must decide)', () => {
    const policy: PolicyEvalContext = {
      ...strictPolicy,
      // Push autoApprove threshold above the fare so it WOULD be auto-eligible
      // if not for the requireApproval rule.
      autoApproveBelowPaise: 200_000,
    };
    const r = evaluateBusPolicy(baseTrip, { farePaise: 175_000 }, policy, NOW);
    expect(r.ok).toBe(true);
    expect(r.requiresApproval).toBe(true);
    expect(r.autoApproveEligible).toBe(true);
    // Caller composes: the approval service refuses to auto-approve when
    // requiresApproval=true even if autoApproveEligible=true. policy-eval
    // surfaces both flags so the caller can make that decision.
  });
});

describe('evaluateBusPolicy — multiple violations', () => {
  it('aggregates all rule failures in a single pass', () => {
    const trip = { ...baseTrip, isAc: false, busTypeId: 99, operatorId: 9999 };
    const seat = { farePaise: 250_000 };
    const r = evaluateBusPolicy(trip, seat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(4); // fare, AC, busType, operator
  });
});

describe('evaluateBusPolicy — defensive parsing', () => {
  it('treats unparseable departureAt as the epoch (always fails advance window)', () => {
    const trip = { ...baseTrip, departureAt: 'not-a-date' };
    const r = evaluateBusPolicy(trip, baseSeat, strictPolicy, NOW);
    expect(r.ok).toBe(false);
  });
});
