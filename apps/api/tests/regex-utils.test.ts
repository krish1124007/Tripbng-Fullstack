// Unit tests for the shared regex helpers — Phase A.3 hardening.

import { describe, expect, it } from 'vitest';
import { containsRegex, escapeRegex, prefixRegex } from '../src/utils/regex.js';

describe('escapeRegex', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegex('a.b*c+?')).toBe('a\\.b\\*c\\+\\?');
    expect(escapeRegex('(group)|alt')).toBe('\\(group\\)\\|alt');
    expect(escapeRegex('start^end$')).toBe('start\\^end\\$');
    expect(escapeRegex('a[b]c')).toBe('a\\[b\\]c');
    expect(escapeRegex('a{1,2}b')).toBe('a\\{1,2\\}b');
    expect(escapeRegex('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves regular characters unchanged', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
    expect(escapeRegex('TRIPBNG-001')).toBe('TRIPBNG-001');
  });
});

describe('containsRegex', () => {
  it('returns null for empty / whitespace / null input', () => {
    expect(containsRegex(null)).toBeNull();
    expect(containsRegex(undefined)).toBeNull();
    expect(containsRegex('')).toBeNull();
    expect(containsRegex('   ')).toBeNull();
  });

  it('builds a case-insensitive matcher by default', () => {
    const re = containsRegex('Hello');
    expect(re?.test('hello world')).toBe(true);
    expect(re?.flags).toContain('i');
  });

  it('escapes metacharacters so adversarial input matches literally', () => {
    // Literal dot-star — without escaping this would match everything.
    const re = containsRegex('.*');
    expect(re?.test('.* literal here')).toBe(true);
    expect(re?.test('anything else')).toBe(false);
  });

  it('caps input length to prevent pathological regex compilation', () => {
    const long = 'a'.repeat(500);
    const re = containsRegex(long);
    // Pattern source carries the trimmed prefix, never the full 500 chars.
    expect(re?.source.length).toBeLessThanOrEqual(250);
  });
});

describe('prefixRegex', () => {
  it('returns null for empty input', () => {
    expect(prefixRegex(null)).toBeNull();
    expect(prefixRegex('')).toBeNull();
  });

  it('builds a ^prefix matcher with escaping', () => {
    const re = prefixRegex('DEL');
    expect(re?.test('DEL')).toBe(true);
    expect(re?.test('DELHI')).toBe(true);
    expect(re?.test('NEWDEL')).toBe(false);
    expect(re?.source.startsWith('^')).toBe(true);
  });
});
