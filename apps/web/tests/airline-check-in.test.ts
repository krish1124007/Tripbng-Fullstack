// Phase-G tests for the airline check-in directory + URL/window helpers.
// Pure-function tests — no React tree involved.

import { describe, expect, it } from 'vitest';
import {
  buildCheckInUrl,
  checkInWindow,
  lookupAirlineCheckIn,
} from '@/lib/airline-check-in';

describe('lookupAirlineCheckIn', () => {
  it('returns the entry for known carriers (case-insensitive)', () => {
    expect(lookupAirlineCheckIn('6E')?.name).toBe('IndiGo');
    expect(lookupAirlineCheckIn('6e')?.name).toBe('IndiGo');
    expect(lookupAirlineCheckIn('AI')?.name).toBe('Air India');
  });

  it('returns null for unknown carriers', () => {
    expect(lookupAirlineCheckIn('XY')).toBeNull();
    expect(lookupAirlineCheckIn('')).toBeNull();
    expect(lookupAirlineCheckIn(null)).toBeNull();
    expect(lookupAirlineCheckIn(undefined)).toBeNull();
  });
});

describe('buildCheckInUrl', () => {
  it('substitutes PNR + lastName when the carrier supports prefill', () => {
    const indigo = lookupAirlineCheckIn('6E')!;
    const url = buildCheckInUrl(indigo, 'ABC123', 'Sharma');
    expect(url).toContain('pnr=ABC123');
    expect(url).toContain('lastName=Sharma');
  });

  it('URL-encodes whitespace + reserved characters in last names', () => {
    const indigo = lookupAirlineCheckIn('6E')!;
    // encodeURIComponent escapes the chars that actually break a query
    // string. Apostrophes are RFC-allowed in query values so they pass
    // through unchanged — what we care about is space (%20) and & (%26).
    const url = buildCheckInUrl(indigo, 'XYZ789', 'Van Der Berg');
    expect(url).toContain('lastName=Van%20Der%20Berg');
    const url2 = buildCheckInUrl(indigo, 'XYZ790', 'A&B');
    expect(url2).toContain('lastName=A%26B');
  });

  it('returns the bare template for carriers without prefill support', () => {
    const ai = lookupAirlineCheckIn('AI')!;
    const url = buildCheckInUrl(ai, 'ABC123', 'Sharma');
    expect(url).toBe(ai.urlTemplate);
    expect(url).not.toContain('{pnr}');
    expect(url).not.toContain('ABC123');
  });
});

describe('checkInWindow', () => {
  const indigo = lookupAirlineCheckIn('6E')!;

  it('OPEN when now is between opensAt and closesAt', () => {
    const departure = new Date('2026-06-01T10:00:00Z');
    // 24h before departure — well inside IndiGo's 48h window.
    const now = new Date(departure.getTime() - 24 * 60 * 60 * 1000);
    const status = checkInWindow(indigo, departure, now);
    expect(status.open).toBe(true);
    expect(status.reason).toBe('OPEN');
  });

  it('TOO_EARLY when now is before opensAt', () => {
    const departure = new Date('2026-06-01T10:00:00Z');
    // 72h before departure — outside 48h window.
    const now = new Date(departure.getTime() - 72 * 60 * 60 * 1000);
    const status = checkInWindow(indigo, departure, now);
    expect(status.open).toBe(false);
    expect(status.reason).toBe('TOO_EARLY');
    expect(status.opensAt!.getTime()).toBe(departure.getTime() - 48 * 60 * 60 * 1000);
  });

  it('CLOSED when now is past closesAt but before departure', () => {
    const departure = new Date('2026-06-01T10:00:00Z');
    // 30 min before departure — past IndiGo's 1h close.
    const now = new Date(departure.getTime() - 30 * 60 * 1000);
    const status = checkInWindow(indigo, departure, now);
    expect(status.open).toBe(false);
    expect(status.reason).toBe('CLOSED');
  });

  it('DEPARTED when now is past departure', () => {
    const departure = new Date('2026-06-01T10:00:00Z');
    const now = new Date(departure.getTime() + 60 * 60 * 1000);
    const status = checkInWindow(indigo, departure, now);
    expect(status.open).toBe(false);
    expect(status.reason).toBe('DEPARTED');
  });
});
