// Unit tests for the GSTIN state-code → state-name resolver (Phase A.12).

import { describe, expect, it } from 'vitest';
import { gstinStateName } from '../src/utils/gstin-state.js';

describe('gstinStateName', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(gstinStateName(null)).toBeNull();
    expect(gstinStateName(undefined)).toBeNull();
    expect(gstinStateName('')).toBeNull();
  });

  it('resolves common state codes', () => {
    expect(gstinStateName('27')).toBe('Maharashtra');
    expect(gstinStateName('29')).toBe('Karnataka');
    expect(gstinStateName('07')).toBe('Delhi');
    expect(gstinStateName('24')).toBe('Gujarat');
    expect(gstinStateName('33')).toBe('Tamil Nadu');
  });

  it('accepts the raw 2-char prefix of a GSTIN', () => {
    // Example GSTIN format: 27AABCD1234E1Z5 (Maharashtra)
    const gstin = '27AABCD1234E1Z5';
    expect(gstinStateName(gstin.slice(0, 2))).toBe('Maharashtra');
  });

  it('returns null for unknown / malformed codes', () => {
    expect(gstinStateName('99')).toBeNull();
    expect(gstinStateName('XX')).toBeNull();
    expect(gstinStateName('foo')).toBeNull();
  });

  it('handles single-digit codes by left-padding to two chars', () => {
    // GSTIN prefixes are always 2 chars on the wire, but defensive
    // padding handles upstream callers that strip leading zeros.
    expect(gstinStateName('7')).toBe('Delhi');
    expect(gstinStateName('1')).toBe('Jammu and Kashmir');
  });
});
