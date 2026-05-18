// Pure-function tests for TBO reference-data response parsers.
//
// TBO's docs across versions wrap list responses in three different shapes
// (flat array, nested-key, hoisted). The unwrapList helper picks the right
// path; these tests lock that behaviour in so future TBO changes don't
// silently break the sync pipeline.

import { describe, expect, it } from 'vitest';
import {
  normalizeStringList,
  toNumberOrNull,
  trimOrNull,
  unwrapList,
} from '../src/adapters/tbo/parsers.js';

describe('unwrapList', () => {
  it('extracts a flat array at the first candidate path', () => {
    const items = [{ Code: 'IN' }, { Code: 'US' }];
    expect(unwrapList({ CountryList: items }, ['CountryList'])).toEqual(items);
  });

  it('walks dotted candidate paths', () => {
    const items = [{ Code: 'IN' }];
    expect(
      unwrapList({ CountryList: { Country: items } }, ['CountryList.Country']),
    ).toEqual(items);
  });

  it('returns the first path that resolves to an array', () => {
    const items = [{ Code: 'IN' }];
    const obj = { CountryList: 'wrong-shape', Countries: items };
    expect(unwrapList(obj, ['CountryList', 'Countries'])).toEqual(items);
  });

  it('returns [] when no candidate matches (caller decides what to do)', () => {
    expect(unwrapList({ Other: 'value' }, ['CountryList', 'Cities'])).toEqual([]);
  });

  it('returns [] for null / undefined input', () => {
    expect(unwrapList(null, ['CountryList'])).toEqual([]);
    expect(unwrapList(undefined, ['CountryList'])).toEqual([]);
  });

  it('handles non-array values at the path gracefully', () => {
    expect(unwrapList({ CountryList: { not: 'an-array' } }, ['CountryList'])).toEqual([]);
  });
});

describe('toNumberOrNull', () => {
  it('passes numbers through', () => {
    expect(toNumberOrNull(42)).toBe(42);
    expect(toNumberOrNull(3.14)).toBe(3.14);
    expect(toNumberOrNull(0)).toBe(0);
  });

  it('coerces numeric strings (TBO returns lat/lng as strings)', () => {
    expect(toNumberOrNull('19.0760')).toBe(19.076);
    expect(toNumberOrNull('72.8777')).toBe(72.8777);
  });

  it('returns null for empty / null / undefined / NaN', () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull('')).toBeNull();
    expect(toNumberOrNull('not-a-number')).toBeNull();
    expect(toNumberOrNull(Number.NaN)).toBeNull();
  });
});

describe('trimOrNull', () => {
  it('trims surrounding whitespace', () => {
    expect(trimOrNull('  hello  ')).toBe('hello');
  });

  it('returns null for empty / non-string input', () => {
    expect(trimOrNull('')).toBeNull();
    expect(trimOrNull('   ')).toBeNull();
    expect(trimOrNull(null)).toBeNull();
    expect(trimOrNull(42)).toBeNull();
  });
});

describe('normalizeStringList', () => {
  it('handles arrays of strings', () => {
    expect(normalizeStringList(['Wi-Fi', 'Pool', 'Spa'])).toEqual(['Wi-Fi', 'Pool', 'Spa']);
  });

  it('handles arrays of {Name} objects', () => {
    expect(
      normalizeStringList([{ Name: 'Wi-Fi' }, { Name: 'Pool' }]),
    ).toEqual(['Wi-Fi', 'Pool']);
  });

  it('splits CSV / pipe / semicolon strings', () => {
    expect(normalizeStringList('Wi-Fi, Pool , Spa')).toEqual(['Wi-Fi', 'Pool', 'Spa']);
    expect(normalizeStringList('Wi-Fi;Pool;Spa')).toEqual(['Wi-Fi', 'Pool', 'Spa']);
    expect(normalizeStringList('Wi-Fi|Pool|Spa')).toEqual(['Wi-Fi', 'Pool', 'Spa']);
  });

  it('drops empty entries', () => {
    expect(normalizeStringList(['Wi-Fi', '', '  ', 'Pool'])).toEqual(['Wi-Fi', 'Pool']);
  });

  it('returns [] for null / undefined', () => {
    expect(normalizeStringList(null)).toEqual([]);
    expect(normalizeStringList(undefined)).toEqual([]);
  });
});
