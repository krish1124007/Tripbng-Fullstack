// Phase 8 — Map Policy pricing tests.
//
// Two surfaces:
//   1. resolveMapPolicy — picks the matching MapPolicy from the DB given
//      tenant + airline + fareType + agencyGroups (pure-ish; reads DB but
//      no writes).
//   2. applyMapPolicyToBreakdown — pure given (breakdown, policy,
//      supplierCommissionPaise). All four component arithmetics asserted
//      against fixed inputs.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { AgencyGroup } from '../src/models/AgencyGroup.js';
import { MapPolicy, type MapPolicyDoc } from '../src/models/MapPolicy.js';
import {
  applyMapPolicyToBreakdown,
  resolveMapPolicy,
  type ResolveMapPolicyInput,
} from '../src/services/pricing/map-policy-pricing.service.js';
import type { FareBreakdown } from '@tripbng/shared';

let tenantId: Types.ObjectId;
let groupAId: Types.ObjectId;
let groupBId: Types.ObjectId;

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `mpp-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Map Policy Pricing',
    domain: 'mpp.test',
  });
  tenantId = tenant._id;
  const a = await AgencyGroup.create({ tenantId, name: 'Group A' });
  const b = await AgencyGroup.create({ tenantId, name: 'Group B' });
  groupAId = a._id as Types.ObjectId;
  groupBId = b._id as Types.ObjectId;
});

afterAll(async () => {
  await MapPolicy.deleteMany({ tenantId });
  await AgencyGroup.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await MapPolicy.deleteMany({ tenantId });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeBreakdown(overrides: Partial<FareBreakdown> = {}): FareBreakdown {
  return {
    baseFarePaise: 500_000,
    taxesPaise: 50_000,
    policyAdjustmentPaise: 0,
    platformMarkupPaise: 0,
    distributorMarkupPaise: 0,
    agencyMarkupPaise: 0,
    discountPaise: 0,
    gstPaise: 0,
    grossAmountPaise: 550_000,
    netToSupplierPaise: 500_000,
    agencyPayablePaise: 550_000,
    distributorEarningsPaise: 0,
    platformEarningsPaise: 0,
    currency: 'INR',
    ...overrides,
  };
}

function baseInput(): ResolveMapPolicyInput {
  return {
    tenantId: String(tenantId),
    productType: 'FLIGHT',
    airline: '6E',
    fareType: 'Regular',
    agencyGroupIds: [String(groupAId)],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveMapPolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveMapPolicy', () => {
  it('returns null when no policy exists', async () => {
    expect(await resolveMapPolicy(baseInput())).toBeNull();
  });

  it('returns null when policy is INACTIVE', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'inactive',
      productType: 'FLIGHT',
      status: 'INACTIVE',
      commission: { enabled: true, payoutPercent: 70 },
    });
    expect(await resolveMapPolicy(baseInput())).toBeNull();
  });

  it('returns null when productType mismatches', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'hotel-only',
      productType: 'HOTEL',
      commission: { enabled: true, payoutPercent: 70 },
    });
    expect(await resolveMapPolicy(baseInput())).toBeNull();
  });

  it('matches when criteria are all empty (no restrictions)', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'open',
      productType: 'FLIGHT',
      commission: { enabled: true, payoutPercent: 70 },
    });
    const found = await resolveMapPolicy(baseInput());
    expect(found?.name).toBe('open');
  });

  it('respects airline whitelist', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'AI only',
      productType: 'FLIGHT',
      commission: { enabled: true, payoutPercent: 70 },
      criteria: { airlineCodes: ['AI'] },
    });
    expect(await resolveMapPolicy({ ...baseInput(), airline: '6E' })).toBeNull();
    expect((await resolveMapPolicy({ ...baseInput(), airline: 'AI' }))?.name).toBe('AI only');
  });

  it('respects fareType whitelist (case-insensitive)', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'Regular only',
      productType: 'FLIGHT',
      commission: { enabled: true, payoutPercent: 70 },
      criteria: { fareTypes: ['REGULAR'] },
    });
    expect((await resolveMapPolicy({ ...baseInput(), fareType: 'regular' }))?.name).toBe(
      'Regular only',
    );
    expect(await resolveMapPolicy({ ...baseInput(), fareType: 'SME' })).toBeNull();
    // No fareType on the option + criteria.fareTypes set → no match
    expect(await resolveMapPolicy({ ...baseInput(), fareType: null })).toBeNull();
  });

  it('respects agencyGroup overlap', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'Group A only',
      productType: 'FLIGHT',
      criteria: { agencyGroupIds: [groupAId] },
    });
    expect((await resolveMapPolicy({ ...baseInput(), agencyGroupIds: [String(groupAId)] }))?.name).toBe(
      'Group A only',
    );
    expect(await resolveMapPolicy({ ...baseInput(), agencyGroupIds: [String(groupBId)] })).toBeNull();
    expect(await resolveMapPolicy({ ...baseInput(), agencyGroupIds: [] })).toBeNull();
  });

  it('picks the higher-priority policy when two match', async () => {
    await MapPolicy.create({
      tenantId,
      name: 'low',
      productType: 'FLIGHT',
      priority: 100,
      commission: { enabled: true, payoutPercent: 50 },
    });
    await MapPolicy.create({
      tenantId,
      name: 'high',
      productType: 'FLIGHT',
      priority: 10, // lower number = higher priority
      commission: { enabled: true, payoutPercent: 70 },
    });
    const found = await resolveMapPolicy(baseInput());
    expect(found?.name).toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyMapPolicyToBreakdown
// ─────────────────────────────────────────────────────────────────────────────

async function createPolicy(overrides: Partial<MapPolicyDoc>): Promise<MapPolicyDoc> {
  return (await MapPolicy.create({
    tenantId,
    name: 'test',
    productType: 'FLIGHT',
    ...overrides,
  })) as unknown as MapPolicyDoc;
}

describe('applyMapPolicyToBreakdown', () => {
  it('is a no-op when no components are enabled', () => {
    const policy = {
      commission: { enabled: false },
      plb: { enabled: false },
      b2bMarkup: { enabled: false },
      managementFee: { enabled: false },
    } as unknown as MapPolicyDoc;
    const breakdown = makeBreakdown();
    const result = applyMapPolicyToBreakdown(breakdown, policy, {
      supplierCommissionPaise: 0,
    });
    expect(result.trace).toEqual([]);
    expect(result.totalDeltaPaise).toBe(0);
    expect(result.breakdown).toEqual(breakdown);
  });

  it('commission: passes 70% of supplier commission to agent as discount', () => {
    const policy = {
      commission: { enabled: true, name: '70% PASS', payoutPercent: 70 },
    } as unknown as MapPolicyDoc;
    const breakdown = makeBreakdown({
      grossAmountPaise: 550_000,
      agencyPayablePaise: 550_000,
      platformEarningsPaise: 75_000,
      discountPaise: 0,
    });
    const result = applyMapPolicyToBreakdown(breakdown, policy, {
      supplierCommissionPaise: 75_000, // 15% of 500k base
    });
    // 70% × 75_000 = 52_500
    expect(result.totalDeltaPaise).toBe(-52_500);
    expect(result.breakdown.grossAmountPaise).toBe(497_500);
    expect(result.breakdown.agencyPayablePaise).toBe(497_500);
    expect(result.breakdown.platformEarningsPaise).toBe(22_500);
    expect(result.breakdown.discountPaise).toBe(52_500);
    expect(result.trace[0]?.component).toBe('commission');
    expect(result.trace[0]?.ruleName).toBe('70% PASS');
  });

  it('commission is a no-op when supplierCommissionPaise is 0', () => {
    const policy = {
      commission: { enabled: true, payoutPercent: 70 },
    } as unknown as MapPolicyDoc;
    const result = applyMapPolicyToBreakdown(makeBreakdown(), policy, {
      supplierCommissionPaise: 0,
    });
    expect(result.trace).toEqual([]);
  });

  it('plb stacks with commission on the same commission pool', () => {
    const policy = {
      commission: { enabled: true, payoutPercent: 70 },
      plb: { enabled: true, payoutPercent: 10 },
    } as unknown as MapPolicyDoc;
    const breakdown = makeBreakdown({ platformEarningsPaise: 100_000 });
    const result = applyMapPolicyToBreakdown(breakdown, policy, {
      supplierCommissionPaise: 100_000,
    });
    // commission 70_000 + plb 10_000 = 80_000 total discount
    expect(result.totalDeltaPaise).toBe(-80_000);
    expect(result.trace.map((t) => t.component)).toEqual(['commission', 'plb']);
  });

  it('b2bMarkup ABSOLUTE adds paise to fare', () => {
    const policy = {
      b2bMarkup: { enabled: true, name: 'CHARGE', valueType: 'ABSOLUTE', value: 25_000 },
    } as unknown as MapPolicyDoc;
    const result = applyMapPolicyToBreakdown(makeBreakdown(), policy, {
      supplierCommissionPaise: 0,
    });
    expect(result.totalDeltaPaise).toBe(25_000);
    expect(result.breakdown.grossAmountPaise).toBe(575_000);
    expect(result.breakdown.agencyPayablePaise).toBe(575_000);
    expect(result.breakdown.platformEarningsPaise).toBe(25_000);
    expect(result.breakdown.policyAdjustmentPaise).toBe(25_000);
  });

  it('b2bMarkup PERCENT applies on (baseFare + taxes)', () => {
    const policy = {
      b2bMarkup: { enabled: true, valueType: 'PERCENT', value: 2 },
    } as unknown as MapPolicyDoc;
    // base 500k + tax 50k = 550k. 2% = 11_000.
    const result = applyMapPolicyToBreakdown(makeBreakdown(), policy, {
      supplierCommissionPaise: 0,
    });
    expect(result.totalDeltaPaise).toBe(11_000);
  });

  it('managementFee ABSOLUTE adds paise; hideFromAgent surfaces in trace', () => {
    const policy = {
      managementFee: {
        enabled: true,
        name: 'IDRS',
        valueType: 'ABSOLUTE',
        value: 1_000,
        hideFromAgent: true,
      },
    } as unknown as MapPolicyDoc;
    const result = applyMapPolicyToBreakdown(makeBreakdown(), policy, {
      supplierCommissionPaise: 0,
    });
    expect(result.totalDeltaPaise).toBe(1_000);
    expect(result.breakdown.grossAmountPaise).toBe(551_000);
    expect(result.trace[0]?.hidden).toBe(true);
    expect(result.trace[0]?.ruleName).toBe('IDRS');
  });

  it('all four components stack in order', () => {
    const policy = {
      commission: { enabled: true, payoutPercent: 70 },
      plb: { enabled: true, payoutPercent: 10 },
      b2bMarkup: { enabled: true, valueType: 'ABSOLUTE', value: 5_000 },
      managementFee: { enabled: true, valueType: 'ABSOLUTE', value: 1_000 },
    } as unknown as MapPolicyDoc;
    const breakdown = makeBreakdown({ platformEarningsPaise: 100_000 });
    const result = applyMapPolicyToBreakdown(breakdown, policy, {
      supplierCommissionPaise: 100_000,
    });
    // commission -70_000, plb -10_000, b2b +5_000, fee +1_000 = -74_000 net
    expect(result.totalDeltaPaise).toBe(-74_000);
    expect(result.breakdown.grossAmountPaise).toBe(550_000 - 74_000);
    expect(result.trace).toHaveLength(4);
    expect(result.trace.map((t) => t.component)).toEqual([
      'commission',
      'plb',
      'b2bMarkup',
      'managementFee',
    ]);
  });

  it('worked example: 70% commission + ₹10 management fee on a typical fare', () => {
    // Mirrors the example in screenshot 4-5:
    //   Commission Name: 70% PASS, payoutPercent: 70
    //   Management Fee: ₹10 = 1000 paise, ABSOLUTE
    //   Supplier commission: assume 5% of 500k base = 25_000 paise.
    const policy = {
      commission: { enabled: true, name: '70% PASS', payoutPercent: 70 },
      managementFee: { enabled: true, valueType: 'ABSOLUTE', value: 1_000 },
    } as unknown as MapPolicyDoc;
    const result = applyMapPolicyToBreakdown(makeBreakdown(), policy, {
      supplierCommissionPaise: 25_000,
    });
    // commission -17_500 (70% × 25k), fee +1_000 → net -16_500
    expect(result.totalDeltaPaise).toBe(-16_500);
    expect(result.breakdown.grossAmountPaise).toBe(550_000 - 16_500);
    expect(result.breakdown.agencyPayablePaise).toBe(550_000 - 16_500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration with persisted MapPolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapPolicyToBreakdown with persisted MapPolicy', () => {
  it('reads commission settings from a real DB row', async () => {
    const persisted = await createPolicy({
      name: '70% PASS',
      productType: 'FLIGHT',
      commission: { enabled: true, name: '70% PASS', payoutPercent: 70 },
    } as unknown as MapPolicyDoc);
    const result = applyMapPolicyToBreakdown(makeBreakdown(), persisted, {
      supplierCommissionPaise: 100_000,
    });
    expect(result.totalDeltaPaise).toBe(-70_000);
    expect(result.trace[0]?.ruleName).toBe('70% PASS');
  });
});
