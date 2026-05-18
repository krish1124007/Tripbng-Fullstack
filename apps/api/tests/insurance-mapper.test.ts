// Pure-function tests for the TripBng → ASEGO mapper. No I/O, no Mongo, no
// network — just verifying the transformations match the OpenAPI spec.

import { describe, expect, it } from 'vitest';
import type { InsuranceIssueRequest, InsuranceTraveler } from '@tripbng/shared';
import {
  computeAge,
  computeDuration,
  mapToExternalPolicies,
  redactPolicyForAudit,
  resolveRiderAmount,
} from '../src/services/insurance/mapper.js';
import type { AsegoIdentityConfig } from '../src/adapters/asego/identity.js';

const IDENTITY: AsegoIdentityConfig = {
  partnerId: 'pid-test',
  sign: 'sign-test',
  reference: 'ref-test',
};

const oneTraveler = (overrides: Partial<InsuranceTraveler> = {}): InsuranceTraveler => ({
  type: 'ADULT',
  title: 'MR',
  firstName: 'Test',
  lastName: 'Buyer',
  dateOfBirth: '1990-01-15',
  gender: 'M',
  email: 'test@tripbng.dev',
  mobileNo: '9999999999',
  pincode: '110001',
  address: '1 Test Lane',
  district: 'New Delhi',
  state: 'Delhi',
  country: 'India',
  nominee: { firstName: 'Self', lastName: 'Buyer', relation: 'Self' },
  ...overrides,
});

const baseReq: InsuranceIssueRequest = {
  quotation: {
    startDate: '2026-06-01',
    endDate: '2026-06-08',
    category: 'cat-uuid',
    destination: 'Goa',
  },
  selectedPlan: {
    insurerId: 'ins-1',
    insurerName: 'ICICI',
    planId: 'plan-1',
    planName: 'Smart Domestic',
    sellingPlanId: 'plan-1',
    totalPremiumPaise: 50_000,
    riders: [],
  },
  travelers: [oneTraveler()],
};

const ASOF = new Date('2026-05-04T00:00:00Z');

describe('computeAge', () => {
  it('returns the whole-year age at the given asOf', () => {
    expect(computeAge('1990-01-15', new Date('2026-05-04'))).toBe(36);
  });
  it('subtracts a year when birthday has not occurred this year', () => {
    expect(computeAge('1990-12-31', new Date('2026-05-04'))).toBe(35);
  });
  it('handles birthday-today exactly', () => {
    expect(computeAge('2000-05-04', new Date('2026-05-04'))).toBe(26);
  });
});

describe('computeDuration', () => {
  it('counts inclusive of both start + end (1-day trip = duration 2 per ASEGO convention)', () => {
    expect(computeDuration('2026-06-01', '2026-06-01')).toBe(1);
    expect(computeDuration('2026-06-01', '2026-06-02')).toBe(2);
    expect(computeDuration('2026-06-01', '2026-06-08')).toBe(8);
  });
  it('clamps to >=1', () => {
    expect(computeDuration('2026-06-08', '2026-06-01')).toBe(1);
  });
});

describe('resolveRiderAmount', () => {
  it('Loading % computes amount as agePremium * pct / 100', () => {
    const r = resolveRiderAmount(
      { riderId: 'r1', riderName: 'Adventure', rateType: 'Loading %', rateValue: 10 },
      500,
    );
    expect(r.percent).toBe(10);
    expect(r.riderAmount).toBe(50);
  });
  it('Rider Value uses the scalar verbatim', () => {
    const r = resolveRiderAmount(
      { riderId: 'r2', riderName: 'CFAR', rateType: 'Rider Value', rateValue: 250 },
      500,
    );
    expect(r.percent).toBe(0);
    expect(r.riderAmount).toBe(250);
  });
});

describe('mapToExternalPolicies', () => {
  it('returns one entry per traveler', () => {
    const req: InsuranceIssueRequest = {
      ...baseReq,
      travelers: [oneTraveler({ firstName: 'A' }), oneTraveler({ firstName: 'B' })],
    };
    const out = mapToExternalPolicies(req, IDENTITY, 'order-1', ASOF);
    expect(out).toHaveLength(2);
    expect(out[0]!.traveler.name).toBe('A Buyer');
    expect(out[1]!.traveler.name).toBe('B Buyer');
  });

  it('uses ASEGO field names exactly per OpenAPI', () => {
    const out = mapToExternalPolicies(baseReq, IDENTITY, 'order-1', ASOF);
    const e = out[0]!;

    // ExternalPolicy required fields
    expect(e.identity).toBeDefined();
    expect(e.selectedPlan).toBeDefined();
    expect(e.quotation).toBeDefined();
    expect(e.traveler).toBeDefined();
    expect(e.otherDetails).toBeDefined();

    // Quotation: travelCategory NOT category
    expect(e.quotation.travelCategory).toBe('cat-uuid');
    expect((e.quotation as Record<string, unknown>).category).toBeUndefined();

    // selectedPlan.plan is nested
    expect(e.selectedPlan.plan).toBeDefined();
    expect(e.selectedPlan.plan.sellingPlanId).toBe('plan-1');
    expect(e.selectedPlan.plan.agePremiums).toEqual({ age: 36, premium: 500 });

    // traveler.name is single string
    expect(e.traveler.name).toBe('Test Buyer');

    // traveler.nominee is a STRING, relation is a sibling
    expect(e.traveler.nominee).toBe('Self Buyer');
    expect(e.traveler.relation).toBe('Self');

    // city + finalPremium are required
    expect(e.traveler.city).toBe('New Delhi');
    expect(e.traveler.finalPremium).toBe(500);

    // No `title` on the wire
    expect((e.traveler as Record<string, unknown>).title).toBeUndefined();
  });

  it('totalPremium is per-traveler (totalPremiumPaise / count) in rupees', () => {
    const req: InsuranceIssueRequest = {
      ...baseReq,
      // 100,000 paise = ₹1,000 total for 2 travellers → ₹500 each
      selectedPlan: { ...baseReq.selectedPlan, totalPremiumPaise: 100_000 },
      travelers: [oneTraveler(), oneTraveler()],
    };
    const out = mapToExternalPolicies(req, IDENTITY, 'order-1', ASOF);
    expect(out[0]!.selectedPlan.totalPremium).toBe(500);
    expect(out[1]!.selectedPlan.totalPremium).toBe(500);
  });

  it('orderId is propagated into every entry', () => {
    const out = mapToExternalPolicies(baseReq, IDENTITY, 'my-booking-123', ASOF);
    expect(out[0]!.identity.orderId).toBe('my-booking-123');
  });
});

describe('redactPolicyForAudit', () => {
  it('redacts PII from the traveler', () => {
    const out = mapToExternalPolicies(baseReq, IDENTITY, 'o', ASOF);
    const redacted = redactPolicyForAudit(out[0]!);
    expect(redacted.traveler.email).toBe('[redacted]');
    expect(redacted.traveler.mobileNo).toBe('[redacted]');
    expect(redacted.traveler.pincode).toBe('[redacted]');
    expect(redacted.traveler.address).toBe('[redacted]');
    // Name is non-PII for our purposes (already in customer copy of policy)
    expect(redacted.traveler.name).toBe('Test Buyer');
  });

  it('keeps passport empty when traveler had none', () => {
    const out = mapToExternalPolicies(baseReq, IDENTITY, 'o', ASOF);
    const redacted = redactPolicyForAudit(out[0]!);
    expect(redacted.traveler.passport).toBe('');
  });

  it('redacts passport when present', () => {
    const req: InsuranceIssueRequest = {
      ...baseReq,
      travelers: [oneTraveler({ passport: 'M1234567' })],
    };
    const out = mapToExternalPolicies(req, IDENTITY, 'o', ASOF);
    const redacted = redactPolicyForAudit(out[0]!);
    expect(redacted.traveler.passport).toBe('[redacted]');
  });
});
