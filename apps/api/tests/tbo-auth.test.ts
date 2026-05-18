// Pure-function unit tests for the TBO Phase 0 surface.
//
// What's tested here (no live I/O):
//   - secondsUntilNextMidnightIST — math at IST boundaries
//   - redactForAudit — sensitive keys masked, structure preserved
//   - statusToErrorCode — TBO Status enum mapping
//
// What's NOT tested here:
//   - The real Authenticate round-trip (covered by scripts/tbo-auth-smoke.ts
//     against the sandbox).
//   - Redis lock contention (would need a real Redis to be meaningful).

import { describe, expect, it } from 'vitest';
import { redactForAudit } from '../src/adapters/tbo/redact.js';
import { statusToErrorCode } from '../src/adapters/tbo/errors.js';
import { TBO_STATUS } from '../src/adapters/tbo/types/auth.js';
import { secondsUntilNextMidnightIST } from '../src/services/tbo/time.js';

describe('secondsUntilNextMidnightIST', () => {
  it('returns ~24h when called just after midnight IST', () => {
    // 18:31 UTC = 00:01 IST. So one minute past midnight IST.
    const now = new Date(Date.UTC(2026, 4, 4, 18, 31, 0));
    const secs = secondsUntilNextMidnightIST(now);
    // ~24h - 1min = 86340. Allow ±2s for math.
    expect(secs).toBeGreaterThanOrEqual(86_338);
    expect(secs).toBeLessThanOrEqual(86_342);
  });

  it('returns ~1h when called 1h before midnight IST', () => {
    // 23:00 IST = 17:30 UTC.
    const now = new Date(Date.UTC(2026, 4, 4, 17, 30, 0));
    const secs = secondsUntilNextMidnightIST(now);
    expect(secs).toBeGreaterThanOrEqual(3_598);
    expect(secs).toBeLessThanOrEqual(3_602);
  });

  it('never returns zero (guarantees a positive cache TTL)', () => {
    // Exactly 18:30 UTC = 00:00 IST. Treat as "midnight has just passed"
    // — the helper rolls forward to next midnight (full 24h).
    const now = new Date(Date.UTC(2026, 4, 4, 18, 30, 0));
    expect(secondsUntilNextMidnightIST(now)).toBeGreaterThan(0);
  });
});

describe('redactForAudit', () => {
  it('replaces sensitive top-level keys', () => {
    const input = { ClientId: 'X', UserName: 'foo', Password: 'secret', EndUserIp: '1.2.3.4' };
    const out = redactForAudit(input);
    expect(out).toEqual({
      ClientId: 'X',
      UserName: 'foo',
      Password: '[REDACTED]',
      EndUserIp: '1.2.3.4',
    });
  });

  it('matches keys case-insensitively', () => {
    const out = redactForAudit({ password: 'a', PASSWORD: 'b', Email: 'me@x.com' });
    expect(out).toEqual({
      password: '[REDACTED]',
      PASSWORD: '[REDACTED]',
      Email: '[REDACTED]',
    });
  });

  it('walks nested objects + arrays', () => {
    const input = {
      Member: { LoginName: 'foo', Email: 'me@x.com' },
      Guests: [
        { firstName: 'A', pan: 'ABCDE1234F' },
        { firstName: 'B', passportNo: 'X12345' },
      ],
    };
    const out = redactForAudit(input) as typeof input;
    expect(out.Member.Email).toBe('[REDACTED]');
    expect(out.Guests[0]?.pan).toBe('[REDACTED]');
    expect(out.Guests[1]?.passportNo).toBe('[REDACTED]');
    expect(out.Guests[0]?.firstName).toBe('A'); // not sensitive
  });

  it('returns scalars untouched', () => {
    expect(redactForAudit('hello')).toBe('hello');
    expect(redactForAudit(42)).toBe(42);
    expect(redactForAudit(null)).toBe(null);
    expect(redactForAudit(undefined)).toBe(undefined);
  });

  it('does not mutate the input', () => {
    const input = { Password: 'secret', other: 1 };
    redactForAudit(input);
    expect(input.Password).toBe('secret');
  });
});

describe('statusToErrorCode (TBO Status → domain error)', () => {
  it('returns null for a successful Status', () => {
    expect(statusToErrorCode(TBO_STATUS.SUCCESSFUL)).toBeNull();
  });

  it('maps the failure statuses to distinct codes', () => {
    expect(statusToErrorCode(TBO_STATUS.FAILED)).toBe('TBO_FAILED');
    expect(statusToErrorCode(TBO_STATUS.INVALID_REQUEST)).toBe('TBO_INVALID_REQUEST');
    expect(statusToErrorCode(TBO_STATUS.INVALID_SESSION)).toBe('TBO_INVALID_SESSION');
    expect(statusToErrorCode(TBO_STATUS.INVALID_CREDENTIALS)).toBe('TBO_INVALID_CREDENTIALS');
  });
});
