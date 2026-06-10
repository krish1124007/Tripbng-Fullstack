// Pure-function tests for the Money utility (packages/shared/src/money).
// No I/O, no Mongo — exercises conversion, rounding, formatting, and the spec
// example from AGENCY_WALLET_SYSTEM.md (₹1,00,000 deposit → ₹980 net incentive
// after 2% TDS on a 1% incentive).

import { describe, expect, it } from 'vitest';
import { Money } from '@tripbng/shared';

describe('Money utility', () => {
  describe('fromNumberPaise / toNumberPaise', () => {
    it('round-trips integer paise', () => {
      const p = Money.fromNumberPaise(100_980);
      expect(p).toBe(100_980n);
      expect(Money.toNumberPaise(p)).toBe(100_980);
    });

    it('rejects non-integer numbers', () => {
      expect(() => Money.fromNumberPaise(1.5)).toThrow(/integer/);
    });

    it('rejects NaN / Infinity', () => {
      expect(() => Money.fromNumberPaise(NaN)).toThrow(/finite/);
      expect(() => Money.fromNumberPaise(Infinity)).toThrow(/finite/);
    });

    it('refuses to downcast values above MAX_SAFE_INTEGER', () => {
      const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      expect(() => Money.toNumberPaise(huge)).toThrow(/MAX_SAFE_INTEGER/);
    });

    it('downcasts values within safe range', () => {
      expect(Money.toNumberPaise(0n)).toBe(0);
      expect(Money.toNumberPaise(-50_000n)).toBe(-50_000);
    });
  });

  describe('fromRupees', () => {
    it('parses whole rupees', () => {
      expect(Money.fromRupees(1000)).toBe(100_000n);
      expect(Money.fromRupees('1000')).toBe(100_000n);
    });

    it('parses 2-decimal rupees exactly', () => {
      expect(Money.fromRupees('1234.56')).toBe(123_456n);
      expect(Money.fromRupees(1234.56)).toBe(123_456n);
    });

    it('strips Indian thousand-separators', () => {
      expect(Money.fromRupees('1,00,980.00')).toBe(100_98_000n);
      expect(Money.fromRupees('1,234.50')).toBe(1_23_450n);
    });

    it('rounds half-up by default (away from zero)', () => {
      expect(Money.fromRupees('1.005')).toBe(101n); // 100.5 → 101
      expect(Money.fromRupees('-1.005')).toBe(-101n);
      expect(Money.fromRupees('1.004')).toBe(100n);
    });

    it('truncates with mode=down', () => {
      expect(Money.fromRupees('1.999', 'down')).toBe(199n);
      expect(Money.fromRupees('-1.999', 'down')).toBe(-199n);
    });

    it("rounds halves to even with mode='half-even'", () => {
      // 0.005 → 1 paise (round to even, 0 is even but we add 1; actually 0.5 → 0 because 0 is even)
      // Tie cases: 1.005 ties → 1.00 is even (0 in last digit) → stay → 100n? Actually 100 is even.
      // Standard banker's rounding: halfway → round to even *quotient*. quotient before tie = 100.
      // 100 is even → stay 100. So 1.005 half-even → 100.
      expect(Money.fromRupees('1.005', 'half-even')).toBe(100n);
      // 1.015 ties → quotient 101 is odd → bump to 102.
      expect(Money.fromRupees('1.015', 'half-even')).toBe(102n);
      // Not a tie (third decimal > 5) → still rounds up.
      expect(Money.fromRupees('1.006', 'half-even')).toBe(101n);
    });

    it('handles leading + sign', () => {
      expect(Money.fromRupees('+100.00')).toBe(10_000n);
    });

    it('rejects garbage input', () => {
      expect(() => Money.fromRupees('not a number')).toThrow(/invalid/);
      expect(() => Money.fromRupees('1.2.3')).toThrow(/invalid/);
    });
  });

  describe('toRupeesString', () => {
    it('formats positive paise with 2 decimals', () => {
      expect(Money.toRupeesString(100_980n)).toBe('1009.80');
      expect(Money.toRupeesString(50n)).toBe('0.50');
      expect(Money.toRupeesString(0n)).toBe('0.00');
    });

    it('preserves negative sign', () => {
      expect(Money.toRupeesString(-50n)).toBe('-0.50');
      expect(Money.toRupeesString(-100_980n)).toBe('-1009.80');
    });

    it('pads single-digit paise', () => {
      expect(Money.toRupeesString(105n)).toBe('1.05');
      expect(Money.toRupeesString(100n)).toBe('1.00');
    });
  });

  describe('formatINR / formatINRCompact', () => {
    it('formats with Indian grouping and ₹ symbol', () => {
      // Indian locale groups as 1,00,980 not 100,980. The exact ₹/character may
      // be a non-breaking space depending on ICU — assert structurally.
      const out = Money.formatINR(1_00_98_000n);
      expect(out).toMatch(/₹/);
      expect(out).toMatch(/1,00,980\.00/);
    });

    it('shows two decimals for non-round amounts', () => {
      expect(Money.formatINR(123_456n)).toMatch(/1,234\.56/);
    });

    it('formatINRCompact drops the paise', () => {
      const out = Money.formatINRCompact(1_00_98_000n);
      expect(out).toMatch(/₹/);
      expect(out).toMatch(/1,00,980/);
      expect(out).not.toMatch(/\.00/);
    });
  });

  describe('predicates', () => {
    it('isZero / isPositive / isNegative', () => {
      expect(Money.isZero(0n)).toBe(true);
      expect(Money.isPositive(1n)).toBe(true);
      expect(Money.isPositive(0n)).toBe(false);
      expect(Money.isNegative(-1n)).toBe(true);
    });

    it('eq / gt / gte / lt / lte', () => {
      expect(Money.eq(100n, 100n)).toBe(true);
      expect(Money.gt(101n, 100n)).toBe(true);
      expect(Money.gte(100n, 100n)).toBe(true);
      expect(Money.lt(99n, 100n)).toBe(true);
      expect(Money.lte(100n, 100n)).toBe(true);
    });
  });

  describe('arithmetic', () => {
    it('add / sub', () => {
      expect(Money.add(100n, 50n)).toBe(150n);
      expect(Money.sub(100n, 50n)).toBe(50n);
      expect(Money.sub(50n, 100n)).toBe(-50n); // does not clamp
    });

    it('min / max', () => {
      expect(Money.min(100n, 50n)).toBe(50n);
      expect(Money.max(100n, 50n)).toBe(100n);
    });

    it('sumAll', () => {
      expect(Money.sumAll([1n, 2n, 3n, 4n])).toBe(10n);
      expect(Money.sumAll([])).toBe(0n);
    });
  });

  describe('percent', () => {
    it('1% of ₹1,00,000 = ₹1,000', () => {
      // Spec example: ₹1,00,000 deposit, 1% incentive → ₹1,000
      const deposit = Money.fromRupees(100_000);
      const incentive = Money.percent(deposit, 1);
      expect(incentive).toBe(Money.fromRupees(1000));
    });

    it('2% TDS on ₹1,000 = ₹20', () => {
      const incentive = Money.fromRupees(1000);
      const tds = Money.percent(incentive, 2);
      expect(tds).toBe(Money.fromRupees(20));
    });

    it('rounds half-up by default', () => {
      // 100 paise * 1.5% = 1.5 paise → 2 paise
      expect(Money.percent(100n, 1.5)).toBe(2n);
      // 100 paise * 1.4% = 1.4 paise → 1 paise
      expect(Money.percent(100n, 1.4)).toBe(1n);
    });

    it('handles fractional percent precisely (0.025%)', () => {
      // ₹1,00,000 * 0.025% = ₹25
      const result = Money.percent(Money.fromRupees(100_000), 0.025);
      expect(result).toBe(Money.fromRupees(25));
    });

    it('throws on non-finite percent', () => {
      expect(() => Money.percent(100n, NaN)).toThrow();
      expect(() => Money.percent(100n, Infinity)).toThrow();
    });
  });

  describe('percentBasisPoints', () => {
    it('200 bp = 2% (TDS)', () => {
      const incentive = Money.fromRupees(1000);
      expect(Money.percentBasisPoints(incentive, 200)).toBe(Money.fromRupees(20));
    });

    it('1800 bp = 18% (GST)', () => {
      const taxable = Money.fromRupees(1000);
      expect(Money.percentBasisPoints(taxable, 1800)).toBe(Money.fromRupees(180));
    });

    it('rejects non-integer basis points', () => {
      expect(() => Money.percentBasisPoints(100n, 1.5)).toThrow(/integer/);
    });

    it('exact integer math, no float drift', () => {
      // 1 paise * 1 bp = 0.0001 paise → 0 paise (round half-up of <0.5)
      expect(Money.percentBasisPoints(1n, 1)).toBe(0n);
      // 10_000 paise * 1 bp = 1 paise (exact)
      expect(Money.percentBasisPoints(10_000n, 1)).toBe(1n);
    });
  });

  describe('Spec example — DI incentive flow', () => {
    // ₹1,00,000 deposit → 1% incentive → 2% TDS → ₹1,00,980 net wallet credit
    // From AGENCY_WALLET_SYSTEM.md §3.3.
    it('produces ₹1,00,980 net wallet credit', () => {
      const deposit = Money.fromRupees(100_000);
      const incentive = Money.percent(deposit, 1); // ₹1,000
      const tds = Money.percent(incentive, 2); // ₹20
      const netIncentive = Money.sub(incentive, tds); // ₹980
      const walletCredit = Money.add(deposit, netIncentive); // ₹1,00,980

      expect(incentive).toBe(Money.fromRupees(1000));
      expect(tds).toBe(Money.fromRupees(20));
      expect(netIncentive).toBe(Money.fromRupees(980));
      expect(walletCredit).toBe(Money.fromRupees(100_980));
      expect(Money.formatINR(walletCredit)).toMatch(/1,00,980\.00/);
    });
  });

  describe('rounding mode symmetry across zero', () => {
    // half-up should round away from zero on both sides.
    it('half-up of -1.5 paise = -2 paise (away from zero)', () => {
      // 3 paise / 2 = 1.5 → half-up rounds away from zero (2).
      expect(Money.fromRupees('-0.015')).toBe(-2n);
      expect(Money.fromRupees('0.015')).toBe(2n);
    });
  });
});
