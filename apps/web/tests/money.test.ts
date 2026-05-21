// Phase-E baseline tests — pure helpers in src/lib/money.ts.
//
// These are the first frontend tests in the repo, so they double as a
// smoke test of the harness: Vitest runs, jsdom mounts, no React tree
// involved yet.

import { describe, expect, it } from 'vitest';
import {
  formatPaiseAsINR,
  formatPercentBasisPoints,
  rupeesStringToPaise,
} from '@/lib/money';

describe('formatPaiseAsINR', () => {
  it('formats whole rupees with two decimals by default', () => {
    expect(formatPaiseAsINR(150_000)).toBe('₹1,500.00');
    expect(formatPaiseAsINR(0)).toBe('₹0.00');
  });

  it('drops fractional zeros in compact mode', () => {
    // 1,500.00 → ₹1,500 in compact. Decimal digits drop when the
    // value is a whole rupee count; otherwise still rounds to 2dp.
    expect(formatPaiseAsINR(150_000, { compact: true })).toBe('₹1,500');
  });

  it('uses Indian-grouping (lakh / crore separators)', () => {
    // ₹1,23,456.78 — comma between lakhs + hundreds (en-IN convention).
    expect(formatPaiseAsINR(12_345_678)).toBe('₹1,23,456.78');
  });

  it('handles negative values', () => {
    expect(formatPaiseAsINR(-150_000)).toContain('1,500.00');
    expect(formatPaiseAsINR(-150_000).startsWith('-')).toBe(true);
  });
});

describe('rupeesStringToPaise', () => {
  it('parses a clean rupee string', () => {
    expect(rupeesStringToPaise('1500')).toBe(150_000);
    expect(rupeesStringToPaise('1500.50')).toBe(150_050);
  });

  it('strips currency symbol + commas', () => {
    expect(rupeesStringToPaise('₹1,500.00')).toBe(150_000);
    expect(rupeesStringToPaise('Rs 1,23,456.78')).toBe(12_345_678);
  });

  it('returns 0 for non-numeric input', () => {
    expect(rupeesStringToPaise('abc')).toBe(0);
    expect(rupeesStringToPaise('')).toBe(0);
  });

  it('floors sub-paise precision via float-imprecision-aware rounding', () => {
    // `1.005 * 100` in IEEE 754 is `100.49999…` (the rounding-to-even
    // rule on `1.005` floors it just below 0.5). Math.round picks the
    // nearer integer — 100 here. This is fine for paise math because
    // we never accept fractional paise from the UI on the wire.
    expect(rupeesStringToPaise('1.005')).toBe(100);
    // Clean .50 lift cleanly.
    expect(rupeesStringToPaise('0.50')).toBe(50);
  });
});

describe('formatPercentBasisPoints', () => {
  it('1800 bp → 18.00%', () => {
    expect(formatPercentBasisPoints(1800)).toBe('18.00%');
  });

  it('500 bp → 5.00%', () => {
    expect(formatPercentBasisPoints(500)).toBe('5.00%');
  });

  it('0 bp → 0.00%', () => {
    expect(formatPercentBasisPoints(0)).toBe('0.00%');
  });
});
