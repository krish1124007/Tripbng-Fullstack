import { describe, it, expect } from 'vitest';
import {
  computeMarkupPaise,
  matchesConditions,
  pickRulesByScope,
  priceFare,
  type PricingInput,
  type PricingMarkupRule,
} from '../src/services/pricing/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────
const baseInput = (overrides: Partial<PricingInput> = {}): PricingInput => ({
  baseFarePaise: 500_000,
  taxesPaise: 50_000,
  paxType: 'ADULT',
  travelType: 'DOMESTIC',
  travelClass: 'ECONOMY',
  airline: '6E',
  origin: 'BOM',
  destination: 'DEL',
  agencyId: '507f1f77bcf86cd799439011',
  ...overrides,
});

const rule = (overrides: Partial<PricingMarkupRule> = {}): PricingMarkupRule => ({
  id: 'r1',
  name: 'rule',
  scope: 'PLATFORM',
  valueType: 'FLAT',
  value: 0,
  priority: 100,
  status: 'ACTIVE',
  conditions: {},
  ...overrides,
});

// ── Pure: no policy, no rules, no discount ──────────────────────────────────
describe('priceFare - identity', () => {
  it('passes through base fare and taxes when nothing applies', () => {
    const out = priceFare(baseInput());
    expect(out.baseFarePaise).toBe(500_000);
    expect(out.taxesPaise).toBe(50_000);
    expect(out.grossAmountPaise).toBe(550_000);
    expect(out.policyAdjustmentPaise).toBe(0);
    expect(out.platformMarkupPaise).toBe(0);
    expect(out.distributorMarkupPaise).toBe(0);
    expect(out.agencyMarkupPaise).toBe(0);
    expect(out.discountPaise).toBe(0);
    expect(out.gstPaise).toBe(0);
  });

  it('zero base fare yields zero gross', () => {
    const out = priceFare(baseInput({ baseFarePaise: 0, taxesPaise: 0 }));
    expect(out.grossAmountPaise).toBe(0);
  });

  it('throws on negative baseFarePaise', () => {
    expect(() => priceFare(baseInput({ baseFarePaise: -1 }))).toThrow();
  });

  it('throws on non-integer baseFarePaise', () => {
    expect(() => priceFare(baseInput({ baseFarePaise: 100.5 }))).toThrow();
  });

  it('throws on negative taxesPaise', () => {
    expect(() => priceFare(baseInput({ taxesPaise: -10 }))).toThrow();
  });

  it('records init step in trace', () => {
    const out = priceFare(baseInput());
    expect(out.trace[0]?.step).toBe('init.baseFare');
    expect(out.trace[0]?.afterPaise).toBe(500_000);
  });
});

// ── Policy: commission, mgmt fee, b2bMarkup ─────────────────────────────────
describe('priceFare - policy', () => {
  it('applies b2bMarkup paise', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0,
          managementFeePaise: 0,
          b2bMarkupPaise: 25_000,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
      }),
    );
    expect(out.policyAdjustmentPaise).toBe(25_000);
    expect(out.grossAmountPaise).toBe(500_000 + 25_000 + 50_000);
  });

  it('applies management fee', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0,
          managementFeePaise: 10_000,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
      }),
    );
    expect(out.policyAdjustmentPaise).toBe(10_000);
  });

  it('combines b2bMarkup and management fee', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0,
          managementFeePaise: 10_000,
          b2bMarkupPaise: 25_000,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
      }),
    );
    expect(out.policyAdjustmentPaise).toBe(35_000);
  });

  it('commission is carved out of supplier remit, not added to gross', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 500, // 5%
          managementFeePaise: 0,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
      }),
    );
    expect(out.grossAmountPaise).toBe(550_000);
    expect(out.netToSupplierPaise).toBe(500_000 - 25_000 + 50_000);
    expect(out.platformEarningsPaise).toBe(25_000);
  });

  it('GST on full pre-tax includes base', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0,
          managementFeePaise: 10_000,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 1800,
        },
      }),
    );
    // Pre-tax is 510_000 (base + mgmt). 18% = 91_800.
    expect(out.gstPaise).toBe(91_800);
    expect(out.grossAmountPaise).toBe(510_000 + 50_000 + 91_800);
  });

  it('GST on markup only excludes base fare', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0,
          managementFeePaise: 10_000,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: true,
          gstRateBasisPoints: 1800,
        },
      }),
    );
    // Markup = 10_000. 18% = 1_800.
    expect(out.gstPaise).toBe(1_800);
  });

  it('GST is zero when rate is zero', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0,
          managementFeePaise: 10_000,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
      }),
    );
    expect(out.gstPaise).toBe(0);
  });
});

// ── Markup: platform/distributor/agency, FLAT/PERCENT ───────────────────────
describe('priceFare - markup', () => {
  it('applies PLATFORM FLAT markup', () => {
    const out = priceFare(
      baseInput({ markupRules: [rule({ scope: 'PLATFORM', valueType: 'FLAT', value: 30_000 })] }),
    );
    expect(out.platformMarkupPaise).toBe(30_000);
    expect(out.grossAmountPaise).toBe(500_000 + 30_000 + 50_000);
  });

  it('applies PLATFORM PERCENT markup', () => {
    const out = priceFare(
      baseInput({
        markupRules: [rule({ scope: 'PLATFORM', valueType: 'PERCENT', value: 200 })], // 2%
      }),
    );
    expect(out.platformMarkupPaise).toBe(10_000); // 2% of 500k
  });

  it('caps PERCENT markup at maxValuePaise', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'PERCENT',
            value: 1000, // 10%
            maxValuePaise: 25_000,
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(25_000); // capped from 50_000
  });

  it('DISTRIBUTOR markup applies when distributorId matches', () => {
    const out = priceFare(
      baseInput({
        distributorId: 'd1',
        markupRules: [
          rule({
            id: 'd-rule',
            scope: 'DISTRIBUTOR',
            distributorId: 'd1',
            valueType: 'FLAT',
            value: 15_000,
          }),
        ],
      }),
    );
    expect(out.distributorMarkupPaise).toBe(15_000);
    expect(out.distributorEarningsPaise).toBe(15_000);
  });

  it('DISTRIBUTOR markup skipped when distributorId mismatches', () => {
    const out = priceFare(
      baseInput({
        distributorId: 'd1',
        markupRules: [
          rule({
            scope: 'DISTRIBUTOR',
            distributorId: 'd2',
            valueType: 'FLAT',
            value: 15_000,
          }),
        ],
      }),
    );
    expect(out.distributorMarkupPaise).toBe(0);
  });

  it('DISTRIBUTOR markup skipped when buyer has no distributor', () => {
    const out = priceFare(
      baseInput({
        distributorId: null,
        markupRules: [
          rule({
            scope: 'DISTRIBUTOR',
            distributorId: 'd1',
            valueType: 'FLAT',
            value: 15_000,
          }),
        ],
      }),
    );
    expect(out.distributorMarkupPaise).toBe(0);
  });

  it('AGENCY markup applies when agencyId matches', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({
            scope: 'AGENCY',
            agencyId: '507f1f77bcf86cd799439011',
            valueType: 'FLAT',
            value: 8_000,
          }),
        ],
      }),
    );
    expect(out.agencyMarkupPaise).toBe(8_000);
  });

  it('agency payable subtracts agency markup from gross', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({
            scope: 'AGENCY',
            agencyId: '507f1f77bcf86cd799439011',
            valueType: 'FLAT',
            value: 8_000,
          }),
        ],
      }),
    );
    expect(out.agencyPayablePaise).toBe(out.grossAmountPaise - 8_000);
  });

  it('all three scopes compound in order', () => {
    const out = priceFare(
      baseInput({
        distributorId: 'd1',
        markupRules: [
          rule({ id: 'p', scope: 'PLATFORM', valueType: 'FLAT', value: 10_000 }),
          rule({
            id: 'd',
            scope: 'DISTRIBUTOR',
            distributorId: 'd1',
            valueType: 'FLAT',
            value: 5_000,
          }),
          rule({
            id: 'a',
            scope: 'AGENCY',
            agencyId: '507f1f77bcf86cd799439011',
            valueType: 'FLAT',
            value: 2_000,
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(10_000);
    expect(out.distributorMarkupPaise).toBe(5_000);
    expect(out.agencyMarkupPaise).toBe(2_000);
    expect(out.grossAmountPaise).toBe(500_000 + 10_000 + 5_000 + 2_000 + 50_000);
  });

  it('PERCENT markups compound on the running total', () => {
    const out = priceFare(
      baseInput({
        distributorId: 'd1',
        markupRules: [
          rule({ id: 'p', scope: 'PLATFORM', valueType: 'PERCENT', value: 1000 }), // 10%
          rule({
            id: 'd',
            scope: 'DISTRIBUTOR',
            distributorId: 'd1',
            valueType: 'PERCENT',
            value: 1000,
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(50_000); // 10% of 500k
    // After platform: 550k. Distributor 10% of 550k = 55_000.
    expect(out.distributorMarkupPaise).toBe(55_000);
  });

  it('priority: lower number wins among same scope', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({ id: 'a', scope: 'PLATFORM', valueType: 'FLAT', value: 10_000, priority: 200 }),
          rule({ id: 'b', scope: 'PLATFORM', valueType: 'FLAT', value: 5_000, priority: 50 }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
    expect(out.trace.find((s) => s.step === 'markup.platform')?.ruleId).toBe('b');
  });

  it('PAUSED rules are skipped', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({ scope: 'PLATFORM', valueType: 'FLAT', value: 10_000, status: 'PAUSED' }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('FLAT 0 markup is a no-op (never increases gross)', () => {
    const out = priceFare(
      baseInput({ markupRules: [rule({ scope: 'PLATFORM', valueType: 'FLAT', value: 0 })] }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });
});

// ── Conditions: airline, route, pax, dates, groups ──────────────────────────
describe('priceFare - conditions', () => {
  it('matches airline whitelist', () => {
    const out = priceFare(
      baseInput({
        airline: '6E',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { airlines: ['6E', 'AI'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('skips when airline not in whitelist', () => {
    const out = priceFare(
      baseInput({
        airline: 'SG',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { airlines: ['6E', 'AI'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('matches travelType', () => {
    const out = priceFare(
      baseInput({
        travelType: 'INTERNATIONAL',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { travelType: 'INTERNATIONAL' },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('skips on travelType mismatch', () => {
    const out = priceFare(
      baseInput({
        travelType: 'DOMESTIC',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { travelType: 'INTERNATIONAL' },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('matches travelClass', () => {
    const out = priceFare(
      baseInput({
        travelClass: 'BUSINESS',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { travelClass: 'BUSINESS' },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('matches paxType whitelist', () => {
    const out = priceFare(
      baseInput({
        paxType: 'CHILD',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { paxTypes: ['CHILD', 'INFANT'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('skips on paxType mismatch', () => {
    const out = priceFare(
      baseInput({
        paxType: 'ADULT',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { paxTypes: ['CHILD'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('matches origin', () => {
    const out = priceFare(
      baseInput({
        origin: 'BOM',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { origins: ['BOM', 'DEL'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('matches destination', () => {
    const out = priceFare(
      baseInput({
        destination: 'DEL',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { destinations: ['DEL'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('skips when route does not match', () => {
    const out = priceFare(
      baseInput({
        origin: 'BLR',
        destination: 'CCU',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { origins: ['BOM'], destinations: ['DEL'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('matches agencyGroup', () => {
    const out = priceFare(
      baseInput({
        agencyGroupIds: ['grp1'],
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { agencyGroupIds: ['grp1', 'grp2'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('skips when agencyGroup does not match', () => {
    const out = priceFare(
      baseInput({
        agencyGroupIds: ['grp3'],
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { agencyGroupIds: ['grp1', 'grp2'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('skips before effective date', () => {
    const future = new Date(Date.now() + 86_400_000);
    const out = priceFare(
      baseInput({
        bookingDate: new Date(),
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { effectiveFrom: future },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('skips after effective end', () => {
    const past = new Date(Date.now() - 86_400_000);
    const out = priceFare(
      baseInput({
        bookingDate: new Date(),
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { effectiveTo: past },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('matches inside effective window', () => {
    const start = new Date(Date.now() - 86_400_000);
    const end = new Date(Date.now() + 86_400_000);
    const out = priceFare(
      baseInput({
        bookingDate: new Date(),
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { effectiveFrom: start, effectiveTo: end },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('matches fareClass', () => {
    const out = priceFare(
      baseInput({
        fareClass: 'PROMO',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { fareClasses: ['PROMO'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(5_000);
  });

  it('skips when fareClass missing on input but required by rule', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { fareClasses: ['PROMO'] },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });

  it('AND-combines multiple condition fields (all must match)', () => {
    const out = priceFare(
      baseInput({
        airline: '6E',
        travelType: 'DOMESTIC',
        markupRules: [
          rule({
            scope: 'PLATFORM',
            valueType: 'FLAT',
            value: 5_000,
            conditions: { airlines: ['6E'], travelType: 'INTERNATIONAL' },
          }),
        ],
      }),
    );
    expect(out.platformMarkupPaise).toBe(0);
  });
});

// ── Discount ───────────────────────────────────────────────────────────────
describe('priceFare - discount', () => {
  it('subtracts discount from running total', () => {
    const out = priceFare(baseInput({ discountPaise: 20_000 }));
    expect(out.discountPaise).toBe(20_000);
    expect(out.grossAmountPaise).toBe(500_000 - 20_000 + 50_000);
  });

  it('caps discount at running pre-tax total', () => {
    const out = priceFare(baseInput({ baseFarePaise: 1000, taxesPaise: 0, discountPaise: 5000 }));
    expect(out.discountPaise).toBe(1000);
    expect(out.grossAmountPaise).toBe(0);
  });

  it('zero discount is a no-op', () => {
    const out = priceFare(baseInput({ discountPaise: 0 }));
    expect(out.discountPaise).toBe(0);
    expect(out.grossAmountPaise).toBe(550_000);
  });
});

// ── Settlement allocations ─────────────────────────────────────────────────
describe('priceFare - settlement', () => {
  it('platform earnings = commission + policy adj + platform markup + GST', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 200, // 2%
          managementFeePaise: 5_000,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
        markupRules: [rule({ scope: 'PLATFORM', valueType: 'FLAT', value: 10_000 })],
      }),
    );
    expect(out.platformEarningsPaise).toBe(10_000 + 5_000 + 10_000);
    // commission 2% of 500k = 10_000; mgmt fee 5_000; platform markup 10_000.
  });

  it('netToSupplier = base - commission + taxes (taxes pass through to supplier)', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 500,
          managementFeePaise: 0,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 0,
        },
      }),
    );
    expect(out.netToSupplierPaise).toBe(500_000 - 25_000 + 50_000);
  });

  it('agencyPayable = gross minus agency markup retained', () => {
    const out = priceFare(
      baseInput({
        markupRules: [
          rule({
            scope: 'AGENCY',
            agencyId: '507f1f77bcf86cd799439011',
            valueType: 'FLAT',
            value: 4_000,
          }),
        ],
      }),
    );
    expect(out.grossAmountPaise - out.agencyMarkupPaise).toBe(out.agencyPayablePaise);
  });

  it('distributorEarnings = distributor markup amount', () => {
    const out = priceFare(
      baseInput({
        distributorId: 'd1',
        markupRules: [
          rule({ scope: 'DISTRIBUTOR', distributorId: 'd1', valueType: 'FLAT', value: 7_000 }),
        ],
      }),
    );
    expect(out.distributorEarningsPaise).toBe(7_000);
  });
});

// ── Trace integrity ────────────────────────────────────────────────────────
describe('priceFare - trace', () => {
  it('every step delta sums (to gross + commission carve-out shown separately)', () => {
    const out = priceFare(
      baseInput({
        policy: {
          commissionPercent: 0, // skip commission to keep accounting simple
          managementFeePaise: 5_000,
          b2bMarkupPaise: 0,
          gstOnMarkupOnly: false,
          gstRateBasisPoints: 1800,
        },
        markupRules: [rule({ scope: 'PLATFORM', valueType: 'FLAT', value: 10_000 })],
        discountPaise: 1_000,
      }),
    );
    const sumDeltas = out.trace.reduce((s, t) => s + t.deltaPaise, 0);
    // With no commission step, all deltas should sum to gross.
    expect(sumDeltas).toBe(out.grossAmountPaise);
  });

  it('records ruleId for matched markup rules', () => {
    const out = priceFare(
      baseInput({
        markupRules: [rule({ id: 'plat-1', scope: 'PLATFORM', valueType: 'FLAT', value: 5_000 })],
      }),
    );
    const platformStep = out.trace.find((s) => s.step === 'markup.platform');
    expect(platformStep?.ruleId).toBe('plat-1');
  });

  it('omits skipped scopes from trace', () => {
    const out = priceFare(baseInput());
    expect(out.trace.find((s) => s.step === 'markup.platform')).toBeUndefined();
    expect(out.trace.find((s) => s.step === 'markup.distributor')).toBeUndefined();
    expect(out.trace.find((s) => s.step === 'markup.agency')).toBeUndefined();
  });
});

// ── matchesConditions / pickRulesByScope direct tests ──────────────────────
describe('matchesConditions', () => {
  it('PLATFORM rules match all buyers', () => {
    expect(matchesConditions(rule({ scope: 'PLATFORM' }), baseInput({ distributorId: null }))).toBe(
      true,
    );
  });

  it('returns false for PAUSED rules', () => {
    expect(matchesConditions(rule({ status: 'PAUSED' }), baseInput())).toBe(false);
  });
});

describe('pickRulesByScope', () => {
  it('returns the lowest-priority winner per scope', () => {
    const winners = pickRulesByScope(
      [
        rule({ id: 'a', scope: 'PLATFORM', priority: 200 }),
        rule({ id: 'b', scope: 'PLATFORM', priority: 50 }),
        rule({ id: 'c', scope: 'PLATFORM', priority: 100 }),
      ],
      baseInput(),
    );
    expect(winners.platform?.id).toBe('b');
  });

  it('returns empty when no rules match', () => {
    const winners = pickRulesByScope([], baseInput());
    expect(winners.platform).toBeUndefined();
  });
});

// ── computeMarkupPaise edge cases ──────────────────────────────────────────
describe('computeMarkupPaise', () => {
  it('FLAT returns the literal value', () => {
    expect(computeMarkupPaise(rule({ valueType: 'FLAT', value: 12345 }), 100_000)).toBe(12345);
  });

  it('PERCENT rounds half-away-from-zero', () => {
    // 100_001 paise * 0.0001 (basis point) = 10.0001 → round to 10
    expect(computeMarkupPaise(rule({ valueType: 'PERCENT', value: 1 }), 100_001)).toBe(10);
  });

  it('cap respected for FLAT too', () => {
    expect(
      computeMarkupPaise(
        rule({ valueType: 'FLAT', value: 50_000, maxValuePaise: 10_000 }),
        500_000,
      ),
    ).toBe(10_000);
  });
});

// ── Combined scenario: realistic full pipeline ──────────────────────────────
describe('priceFare - realistic scenarios', () => {
  it('Mumbai-Delhi 6E ECONOMY adult with policy + 3 markup tiers + discount + GST', () => {
    const out = priceFare(
      baseInput({
        baseFarePaise: 450_000,
        taxesPaise: 80_000,
        airline: '6E',
        distributorId: 'd1',
        policy: {
          commissionPercent: 300, // 3%
          managementFeePaise: 5_000,
          b2bMarkupPaise: 10_000,
          gstOnMarkupOnly: true,
          gstRateBasisPoints: 1800,
        },
        markupRules: [
          rule({
            id: 'p',
            scope: 'PLATFORM',
            valueType: 'PERCENT',
            value: 100, // 1%
            conditions: { airlines: ['6E'] },
          }),
          rule({
            id: 'd',
            scope: 'DISTRIBUTOR',
            distributorId: 'd1',
            valueType: 'FLAT',
            value: 3_000,
          }),
          rule({
            id: 'a',
            scope: 'AGENCY',
            agencyId: '507f1f77bcf86cd799439011',
            valueType: 'FLAT',
            value: 1_500,
          }),
        ],
        discountPaise: 2_000,
      }),
    );
    // Manual walkthrough:
    // base 450_000 → +b2bMarkup 10_000 = 460_000 → +mgmt 5_000 = 465_000
    // platform 1% of 465_000 = 4_650 → 469_650
    // distributor flat 3_000 → 472_650
    // agency flat 1_500 → 474_150
    // discount 2_000 → 472_150
    // taxes 80_000 → 552_150 (pre-GST)
    // GST on markup only: policy adj 15_000 + platform 4_650 + dist 3_000 + agency 1_500 = 24_150
    //   18% of 24_150 = 4_347
    // gross = 552_150 + 4_347 = 556_497
    expect(out.policyAdjustmentPaise).toBe(15_000);
    expect(out.platformMarkupPaise).toBe(4_650);
    expect(out.distributorMarkupPaise).toBe(3_000);
    expect(out.agencyMarkupPaise).toBe(1_500);
    expect(out.discountPaise).toBe(2_000);
    expect(out.gstPaise).toBe(4_347);
    expect(out.grossAmountPaise).toBe(556_497);
  });
});
