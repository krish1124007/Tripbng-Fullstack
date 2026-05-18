// Bus cache tests — peak-season TTL + key naming + Redis round-trip.
//
// The pure-function suites (peak-season + key shape) need no setup. The
// round-trip suite mocks `config/redis.ts` so it runs without Redis.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ────────── Pure-function suites ──────────

import {
  BUS_CACHE_KEYS,
  TTL_BPDP_SEC,
  TTL_CITIES_SEC,
  TTL_OFFPEAK_SEC,
  TTL_PEAK_SEC,
  isPeakSeason,
  tripsTtlSec,
} from '../src/services/bus/cache.service.js';

describe('BUS_CACHE_KEYS', () => {
  it('produces stable, namespaced cities key', () => {
    expect(BUS_CACHE_KEYS.cities).toBe('bus:cities:list');
  });

  it('produces stable, namespaced aliases key', () => {
    expect(BUS_CACHE_KEYS.aliases).toBe('bus:aliases:list');
  });

  it('embeds src/dst/doj in trips key', () => {
    expect(BUS_CACHE_KEYS.trips(122, 124, '2026-06-15')).toBe(
      'bus:trips:122:124:2026-06-15',
    );
  });

  it('embeds tripId in bpdp key', () => {
    expect(BUS_CACHE_KEYS.bpdp('TRIP-A1B2')).toBe('bus:bpdp:TRIP-A1B2');
  });

  it('does NOT expose any tripDetails-shaped key (Law 1)', () => {
    // Safety net — if anyone adds a tripDetails key here, the
    // bus-no-trip-details-cache guard test will catch it via file scan.
    // This in-memory check is a second layer of defence.
    const allKeys = Object.values(BUS_CACHE_KEYS).filter((v) => typeof v === 'string') as string[];
    for (const k of allKeys) {
      expect(k.toLowerCase()).not.toContain('tripdetails');
    }
  });
});

describe('isPeakSeason', () => {
  // doj is constructed from the IST midnight via the same helper the
  // service layer uses. We pass a UTC instant slightly after IST
  // midnight to reach into the right calendar day.
  const istDoj = (yyyyMmDd: string): Date =>
    new Date(`${yyyyMmDd}T00:00:00+05:30`);

  it('flags May–June as peak (summer travel)', () => {
    expect(isPeakSeason(istDoj('2026-05-01'))).toBe(true);
    expect(isPeakSeason(istDoj('2026-06-30'))).toBe(true);
  });

  it('flags October + November as peak (Diwali cluster)', () => {
    expect(isPeakSeason(istDoj('2026-10-15'))).toBe(true);
    expect(isPeakSeason(istDoj('2026-11-05'))).toBe(true);
  });

  it('flags March as peak (Holi)', () => {
    expect(isPeakSeason(istDoj('2026-03-10'))).toBe(true);
  });

  it('flags 24-31 December as peak (year-end)', () => {
    expect(isPeakSeason(istDoj('2026-12-24'))).toBe(true);
    expect(isPeakSeason(istDoj('2026-12-31'))).toBe(true);
  });

  it('does not flag early December as peak', () => {
    expect(isPeakSeason(istDoj('2026-12-15'))).toBe(false);
    expect(isPeakSeason(istDoj('2026-12-23'))).toBe(false);
  });

  it('does not flag off-season months as peak', () => {
    expect(isPeakSeason(istDoj('2026-01-15'))).toBe(false);
    expect(isPeakSeason(istDoj('2026-02-05'))).toBe(false);
    expect(isPeakSeason(istDoj('2026-04-10'))).toBe(false);
    expect(isPeakSeason(istDoj('2026-07-20'))).toBe(false);
    expect(isPeakSeason(istDoj('2026-08-01'))).toBe(false);
    expect(isPeakSeason(istDoj('2026-09-30'))).toBe(false);
  });

  it('returns false for invalid Date (defensive)', () => {
    expect(isPeakSeason(new Date(NaN))).toBe(false);
  });
});

describe('tripsTtlSec', () => {
  const istDoj = (yyyyMmDd: string): Date =>
    new Date(`${yyyyMmDd}T00:00:00+05:30`);

  it('returns peak TTL for peak-season doj', () => {
    expect(tripsTtlSec(istDoj('2026-05-15'))).toBe(TTL_PEAK_SEC);
    expect(TTL_PEAK_SEC).toBe(30 * 60);
  });

  it('returns off-peak TTL for off-season doj', () => {
    expect(tripsTtlSec(istDoj('2026-08-15'))).toBe(TTL_OFFPEAK_SEC);
    expect(TTL_OFFPEAK_SEC).toBe(2 * 60 * 60);
  });

  it('cities TTL is 7 days', () => {
    expect(TTL_CITIES_SEC).toBe(7 * 24 * 60 * 60);
  });

  it('bpdp TTL is 1 hour', () => {
    expect(TTL_BPDP_SEC).toBe(60 * 60);
  });
});

// ────────── Round-trip suite (Redis mocked) ──────────

// Build an in-memory redis stub that satisfies the surface the cache
// service uses (.get / .set with EX / .del). vi.mock replaces the module
// before the cache service imports it.
const memStore = new Map<string, { value: string; expiresAt: number }>();

vi.mock('../src/config/redis.js', () => {
  const fakeRedis = {
    get: vi.fn(async (key: string) => {
      const row = memStore.get(key);
      if (!row) return null;
      if (Date.now() > row.expiresAt) {
        memStore.delete(key);
        return null;
      }
      return row.value;
    }),
    set: vi.fn(async (key: string, value: string, _mode: string, ttlSec: number) => {
      memStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      memStore.delete(key);
      return 1;
    }),
  };
  return { redis: fakeRedis, bullmqRedis: fakeRedis };
});

describe('bus.cache — round-trip via mocked Redis', () => {
  beforeEach(() => {
    memStore.clear();
  });
  afterEach(() => {
    memStore.clear();
  });

  it('cities: write then read returns the same payload', async () => {
    const { getCachedCities, setCachedCities } = await import(
      '../src/services/bus/cache.service.js'
    );
    const cities = [
      { id: 122, name: 'Bangalore' },
      { id: 124, name: 'Chennai' },
    ];
    await setCachedCities(cities);
    const back = await getCachedCities();
    expect(back).toEqual(cities);
  });

  it('cities: returns null on cache miss', async () => {
    const { getCachedCities } = await import('../src/services/bus/cache.service.js');
    expect(await getCachedCities()).toBeNull();
  });

  it('cities: invalidates and returns null on JSON corruption', async () => {
    const { BUS_CACHE_KEYS, getCachedCities } = await import(
      '../src/services/bus/cache.service.js'
    );
    memStore.set(BUS_CACHE_KEYS.cities, {
      value: '{ not json',
      expiresAt: Date.now() + 60_000,
    });
    expect(await getCachedCities()).toBeNull();
    // Invalidated:
    expect(memStore.has(BUS_CACHE_KEYS.cities)).toBe(false);
  });

  it('trips: write uses peak-season TTL when doj is peak', async () => {
    const { setCachedTrips, BUS_CACHE_KEYS } = await import(
      '../src/services/bus/cache.service.js'
    );
    const dojDate = new Date('2026-05-15T00:00:00+05:30');
    await setCachedTrips(122, 124, '2026-05-15', [], dojDate);
    const row = memStore.get(BUS_CACHE_KEYS.trips(122, 124, '2026-05-15'));
    expect(row).toBeTruthy();
    // Peak TTL = 1800s. Allow 1s of jitter for clock-precision flakiness.
    const ttlMs = row!.expiresAt - Date.now();
    expect(ttlMs).toBeGreaterThan(1799 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(1800 * 1000);
  });

  it('trips: write uses off-peak TTL when doj is off-season', async () => {
    const { setCachedTrips, BUS_CACHE_KEYS } = await import(
      '../src/services/bus/cache.service.js'
    );
    const dojDate = new Date('2026-08-15T00:00:00+05:30');
    await setCachedTrips(122, 124, '2026-08-15', [], dojDate);
    const row = memStore.get(BUS_CACHE_KEYS.trips(122, 124, '2026-08-15'));
    const ttlMs = row!.expiresAt - Date.now();
    // Off-peak TTL = 7200s.
    expect(ttlMs).toBeGreaterThan(7199 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(7200 * 1000);
  });
});
