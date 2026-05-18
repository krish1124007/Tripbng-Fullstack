// Cancellation policy parser + slab-resolution tests.
//
// Spec §12 edge cases enumerated:
//   - toHr=-1 → "any time before"
//   - first slab fromHr > 0 → inside that window is non-cancellable
//   - charge computed on base fare ONLY
//   - operatorServiceCharge is non-refundable on user cancel (handled
//     elsewhere; this module operates on baseFare only)
//
// Money convention: integer PAISE everywhere. ₹1000 = 100_000 paise.

import { describe, expect, it } from 'vitest';
import {
  chargeForAtDeparture,
  parsePolicy,
  type CancellationSlab,
} from '../src/adapters/seatseller/utils/cancellation-policy.js';

describe('parsePolicy', () => {
  it('parses a typical 3-slab string', () => {
    const slabs = parsePolicy('0:2:100:0|2:24:50:0|24:-1:10:0');
    expect(slabs).toEqual<CancellationSlab[]>([
      { fromHr: 0, toHr: 2, pct: 100, absPaise: 0 },
      { fromHr: 2, toHr: 24, pct: 50, absPaise: 0 },
      { fromHr: 24, toHr: -1, pct: 10, absPaise: 0 },
    ]);
  });

  it('parses a single-slab non-cancellable window', () => {
    expect(parsePolicy('0:24:100:0')).toEqual([
      { fromHr: 0, toHr: 24, pct: 100, absPaise: 0 },
    ]);
  });

  it('returns empty array on empty / null / malformed', () => {
    expect(parsePolicy('')).toEqual([]);
    expect(parsePolicy(null)).toEqual([]);
    expect(parsePolicy(undefined)).toEqual([]);
    expect(parsePolicy('garbage')).toEqual([]);
    expect(parsePolicy('a:b:c:d')).toEqual([]);
  });

  it('skips malformed slabs but keeps valid ones', () => {
    const slabs = parsePolicy('0:2:100:0|garbage|2:-1:50:0');
    expect(slabs).toEqual([
      { fromHr: 0, toHr: 2, pct: 100, absPaise: 0 },
      { fromHr: 2, toHr: -1, pct: 50, absPaise: 0 },
    ]);
  });

  it('sorts slabs by fromHr ascending', () => {
    const slabs = parsePolicy('24:-1:10:0|0:2:100:0|2:24:50:0');
    expect(slabs.map((s) => s.fromHr)).toEqual([0, 2, 24]);
  });

  it('converts absolute charge from rupees to paise', () => {
    expect(parsePolicy('0:24:0:50')).toEqual([
      { fromHr: 0, toHr: 24, pct: 0, absPaise: 5_000 }, // ₹50 = 5000 paise
    ]);
  });
});

describe('chargeForAtDeparture', () => {
  const policy = parsePolicy('0:2:100:0|2:24:50:0|24:-1:10:0');
  const baseFare = 100_000; // ₹1000 in paise

  it('matches the 24h+ slab when cancelling 48h before departure', () => {
    const cancelledAt = new Date('2026-05-10T00:00:00Z');
    const departureAt = new Date('2026-05-12T00:00:00Z'); // 48h later
    const r = chargeForAtDeparture(policy, cancelledAt, departureAt, baseFare);
    expect(r.matchedSlab?.fromHr).toBe(24);
    expect(r.chargePaise).toBe(10_000); // 10% of 100_000
    expect(r.refundPaise).toBe(90_000);
  });

  it('matches the 2-24h slab when cancelling 12h before departure', () => {
    const cancelledAt = new Date('2026-05-12T00:00:00Z');
    const departureAt = new Date('2026-05-12T12:00:00Z');
    const r = chargeForAtDeparture(policy, cancelledAt, departureAt, baseFare);
    expect(r.matchedSlab?.fromHr).toBe(2);
    expect(r.chargePaise).toBe(50_000);
    expect(r.refundPaise).toBe(50_000);
  });

  it('matches the non-cancellable 0-2h slab when cancelling 1h before departure', () => {
    const cancelledAt = new Date('2026-05-12T11:00:00Z');
    const departureAt = new Date('2026-05-12T12:00:00Z');
    const r = chargeForAtDeparture(policy, cancelledAt, departureAt, baseFare);
    expect(r.matchedSlab?.fromHr).toBe(0);
    expect(r.chargePaise).toBe(100_000); // full charge
    expect(r.refundPaise).toBe(0);
  });

  it('clamps charge to baseFare when pct > 100% (operator-side quirk)', () => {
    const oddPolicy = parsePolicy('0:24:120:50');
    const r = chargeForAtDeparture(
      oddPolicy,
      new Date('2026-05-12T11:00:00Z'),
      new Date('2026-05-12T12:00:00Z'),
      baseFare,
    );
    expect(r.chargePaise).toBe(100_000);
    expect(r.refundPaise).toBe(0);
  });

  it('charges 100% when cancelling AFTER departure', () => {
    const cancelledAt = new Date('2026-05-12T13:00:00Z');
    const departureAt = new Date('2026-05-12T12:00:00Z'); // already left
    const r = chargeForAtDeparture(policy, cancelledAt, departureAt, baseFare);
    expect(r.chargePaise).toBe(100_000);
    expect(r.refundPaise).toBe(0);
  });

  it('returns full refund when no slab matches (free-cancel zone)', () => {
    // Policy only covers 0-24h; cancelling 30h before departure has no slab.
    const partial = parsePolicy('0:24:100:0');
    const r = chargeForAtDeparture(
      partial,
      new Date('2026-05-10T18:00:00Z'),
      new Date('2026-05-12T00:00:00Z'),
      baseFare,
    );
    expect(r.matchedSlab).toBeNull();
    expect(r.chargePaise).toBe(0);
    expect(r.refundPaise).toBe(100_000);
  });

  it('returns full refund when policy is empty', () => {
    const r = chargeForAtDeparture(
      [],
      new Date('2026-05-10T00:00:00Z'),
      new Date('2026-05-12T00:00:00Z'),
      baseFare,
    );
    expect(r.matchedSlab).toBeNull();
    expect(r.refundPaise).toBe(100_000);
  });

  it('combines pct + abs charges', () => {
    const policy = parsePolicy('0:24:10:50');
    const r = chargeForAtDeparture(
      policy,
      new Date('2026-05-12T00:00:00Z'),
      new Date('2026-05-12T12:00:00Z'),
      baseFare,
    );
    // 10% of 100_000 = 10_000 paise; +5000 abs = 15_000 paise charge
    expect(r.chargePaise).toBe(15_000);
    expect(r.refundPaise).toBe(85_000);
  });

  it('charges base fare ONLY (never operatorServiceCharge)', () => {
    // The function takes `baseFarePaise` as its argument — total fare is
    // never touched. Sanity check: passing base=50_000 (smaller than what
    // the user paid total) produces a charge based on 50_000.
    const r = chargeForAtDeparture(
      policy,
      new Date('2026-05-12T00:00:00Z'),
      new Date('2026-05-12T12:00:00Z'),
      50_000,
    );
    expect(r.chargePaise).toBe(25_000); // 50% of 50_000
    expect(r.refundPaise).toBe(25_000);
  });

  it('rounds to integer paise (no float drift)', () => {
    const odd = parsePolicy('0:-1:33.33:0');
    const r = chargeForAtDeparture(
      odd,
      new Date('2026-05-12T00:00:00Z'),
      new Date('2026-05-12T12:00:00Z'),
      100_000,
    );
    // 33.33% of 100_000 = 33_330 paise (rounded).
    expect(Number.isInteger(r.chargePaise)).toBe(true);
    expect(Number.isInteger(r.refundPaise)).toBe(true);
    expect(r.chargePaise + r.refundPaise).toBe(100_000);
  });
});
