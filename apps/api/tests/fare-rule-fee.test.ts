import { describe, it, expect } from 'vitest';
import { computePolicyBandFeePaise, matchPolicyBand, deriveLegacyPricing } from '@tripbng/shared';

const band = (o: Partial<Parameters<typeof computePolicyBandFeePaise>[0]> & { fromHours?: number; toHours?: number | null } = {}) => ({
  fromHours: 0,
  toHours: null,
  percentage: 0,
  penaltyAmountPaise: 0,
  additionalFeePaise: 0,
  ...o,
});

describe('matchPolicyBand', () => {
  const bands = [
    band({ fromHours: 0, toHours: 24 }),
    band({ fromHours: 24, toHours: 72 }),
    band({ fromHours: 72, toHours: null }),
  ];
  it('picks the band whose window contains hoursBefore', () => {
    expect(matchPolicyBand(bands, 5)).toBe(bands[0]);
    expect(matchPolicyBand(bands, 48)).toBe(bands[1]);
    expect(matchPolicyBand(bands, 200)).toBe(bands[2]);
  });
  it('treats toHours=null as open-ended and is lower-inclusive', () => {
    expect(matchPolicyBand(bands, 24)).toBe(bands[1]); // boundary belongs to next band
    expect(matchPolicyBand([band({ fromHours: 100, toHours: null })], 5)).toBeUndefined();
  });
});

describe('computePolicyBandFeePaise', () => {
  it('sums percentage of base + flat penalty + additional fee', () => {
    const fee = computePolicyBandFeePaise(
      { percentage: 25, penaltyAmountPaise: 50_000, additionalFeePaise: 10_000 },
      400_000,
    );
    expect(fee).toBe(Math.round(400_000 * 0.25) + 50_000 + 10_000); // 160000
  });
  it('clamps to the base amount (never over-charges)', () => {
    const fee = computePolicyBandFeePaise(
      { percentage: 100, penaltyAmountPaise: 999_999, additionalFeePaise: 0 },
      200_000,
    );
    expect(fee).toBe(200_000);
  });
  it('zero config yields zero fee', () => {
    expect(computePolicyBandFeePaise({ percentage: 0, penaltyAmountPaise: 0, additionalFeePaise: 0 }, 500_000)).toBe(0);
  });
});

describe('deriveLegacyPricing (Policy components → engine fields)', () => {
  it('maps commission % to basis-points×100 and FLAT rupees to paise', () => {
    const out = deriveLegacyPricing({
      commission: { enabled: true, name: '', valueType: 'PERCENT', value: 5, morePayout: false, extraPayouts: [] },
      b2bMarkup: { enabled: true, name: '', valueType: 'FLAT', value: 200, morePayout: false, extraPayouts: [] },
      managementFee: { enabled: true, name: '', valueType: 'FLAT', value: 150, morePayout: false, extraPayouts: [], hideManagementFee: false },
    });
    expect(out.commissionPercent).toBe(500); // 5% → 500 bp×100
    expect(out.b2bMarkupPaise).toBe(20_000); // ₹200 → paise
    expect(out.managementFeePaise).toBe(15_000); // ₹150 → paise
  });
  it('disabled components contribute zero', () => {
    const out = deriveLegacyPricing({
      commission: { enabled: false, name: '', valueType: 'PERCENT', value: 5, morePayout: false, extraPayouts: [] },
    });
    expect(out).toEqual({ commissionPercent: 0, b2bMarkupPaise: 0, managementFeePaise: 0 });
  });
});
