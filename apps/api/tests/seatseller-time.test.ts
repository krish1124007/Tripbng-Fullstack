// SeatSeller time-format utility tests.
//
// CLAUDE.md §11 mandates the exact table at the bottom of this file —
// every row must pass. The other suites cover defensive paths (negative
// inputs, invalid date strings, IST-vs-UTC reconciliation).

import { describe, expect, it } from 'vitest';
import {
  dateToIstYyyyMmDd,
  dojFromIstDateString,
  isNextDayArrival,
  ssMinutesToDate,
} from '../src/adapters/seatseller/utils/time.js';

describe('dojFromIstDateString', () => {
  it('produces IST-midnight (which is UTC 18:30 the previous day)', () => {
    const d = dojFromIstDateString('2026-01-26');
    // IST midnight on 26 Jan = UTC 18:30 on 25 Jan.
    expect(d.toISOString()).toBe('2026-01-25T18:30:00.000Z');
  });

  it('throws on malformed strings', () => {
    expect(() => dojFromIstDateString('2026/01/26')).toThrow();
    expect(() => dojFromIstDateString('2026-1-26')).toThrow();
    expect(() => dojFromIstDateString('not-a-date')).toThrow();
    expect(() => dojFromIstDateString('')).toThrow();
  });

  it('throws on impossible calendar dates', () => {
    expect(() => dojFromIstDateString('2026-13-01')).toThrow();
    expect(() => dojFromIstDateString('2026-02-30')).toThrow();
  });
});

describe('dateToIstYyyyMmDd', () => {
  it('round-trips through dojFromIstDateString', () => {
    const original = '2026-05-12';
    expect(dateToIstYyyyMmDd(dojFromIstDateString(original))).toBe(original);
  });

  it('normalises a UTC instant to its IST calendar date', () => {
    // UTC 19:00 on 2026-01-25 → IST 00:30 on 2026-01-26.
    expect(dateToIstYyyyMmDd(new Date('2026-01-25T19:00:00Z'))).toBe('2026-01-26');
  });

  it('handles UTC instants close to IST midnight', () => {
    // UTC 18:30 on 2026-01-25 == IST 00:00 on 2026-01-26.
    expect(dateToIstYyyyMmDd(new Date('2026-01-25T18:30:00Z'))).toBe('2026-01-26');
  });
});

describe('ssMinutesToDate — CLAUDE.md §11 acceptance table', () => {
  const doj = dojFromIstDateString('2026-01-26');
  const cases: Array<{ ssMinutes: number; istReadable: string; iso: string }> = [
    { ssMinutes: 15, istReadable: '26 Jan 00:15 IST', iso: '2026-01-25T18:45:00.000Z' },
    { ssMinutes: 1295, istReadable: '26 Jan 21:35 IST', iso: '2026-01-26T16:05:00.000Z' },
    { ssMinutes: 1500, istReadable: '27 Jan 01:00 IST', iso: '2026-01-26T19:30:00.000Z' },
    { ssMinutes: 0, istReadable: '26 Jan 00:00 IST', iso: '2026-01-25T18:30:00.000Z' },
  ];
  for (const c of cases) {
    it(`maps ${c.ssMinutes} minutes → ${c.istReadable}`, () => {
      expect(ssMinutesToDate(doj, c.ssMinutes).toISOString()).toBe(c.iso);
    });
  }
});

describe('ssMinutesToDate — defensive paths', () => {
  const doj = dojFromIstDateString('2026-01-26');

  it('clamps negative inputs to 0', () => {
    expect(ssMinutesToDate(doj, -100).toISOString()).toBe(doj.toISOString());
  });

  it('floors non-integer inputs', () => {
    // 15.7 → 15 → IST 00:15
    expect(ssMinutesToDate(doj, 15.7).toISOString()).toBe('2026-01-25T18:45:00.000Z');
  });
});

describe('isNextDayArrival', () => {
  it('detects arrival ≥ 24h via the >=1440 sentinel', () => {
    expect(isNextDayArrival(1290, 1500)).toBe(true);
    expect(isNextDayArrival(1290, 1440)).toBe(true);
  });

  it('detects arrival < departure (operator emits wrapped minutes)', () => {
    expect(isNextDayArrival(1320, 120)).toBe(true);
  });

  it('returns false for same-day morning trips', () => {
    expect(isNextDayArrival(360, 720)).toBe(false);
  });

  it('returns false when arrival equals departure (no-op)', () => {
    expect(isNextDayArrival(720, 720)).toBe(false);
  });
});
