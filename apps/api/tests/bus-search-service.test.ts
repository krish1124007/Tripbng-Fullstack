// Bus search/trip service tests.
//
// Uses the real MockSeatSellerClient via the factory's test hook,
// plus a vi.mock'd Redis (in-memory) so cache writes don't need a
// real broker. This covers the orchestration logic in
// search.service + trip.service end-to-end.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { MockSeatSellerClient } from '../src/adapters/seatseller/mock-client.js';
import { _resetSeatSellerClientForTests } from '../src/adapters/seatseller/factory.js';
import {
  getCityAutocomplete,
  searchBuses,
} from '../src/services/bus/search.service.js';
import {
  getBpDpDetails,
  getTripDetails,
} from '../src/services/bus/trip.service.js';
import { SeatSellerError } from '../src/adapters/seatseller/errors.js';

let mock: MockSeatSellerClient;

beforeEach(() => {
  memStore.clear();
  mock = new MockSeatSellerClient();
  _resetSeatSellerClientForTests(mock);
});

afterEach(() => {
  _resetSeatSellerClientForTests();
});

describe('searchBuses — happy path', () => {
  it('returns trips with resolved ISO timestamps', async () => {
    const result = await searchBuses({
      source: 122,
      destination: 124,
      doj: '2026-06-15',
    });
    expect(result.trips.length).toBeGreaterThan(0);
    expect(result.fromCache).toBe(false);
    const t = result.trips[0]!;
    expect(t.departureAt).toMatch(/^2026-/); // ISO string
    expect(t.arrivalAt).toMatch(/^2026-/);
    expect(t.tripId).toBe('MOCK-TRIP-122-124-2026-06-15');
  });

  it('round-trips through cache: second call has fromCache=true', async () => {
    await searchBuses({ source: 122, destination: 124, doj: '2026-06-15' });
    const second = await searchBuses({
      source: 122,
      destination: 124,
      doj: '2026-06-15',
    });
    expect(second.fromCache).toBe(true);
  });

  it('sorts trips by departureAt ascending', async () => {
    const result = await searchBuses({ source: 122, destination: 124, doj: '2026-06-15' });
    const sorted = [...result.trips].sort((a, b) => a.departureAt.localeCompare(b.departureAt));
    expect(result.trips.map((t) => t.departureAt)).toEqual(sorted.map((t) => t.departureAt));
  });
});

describe('searchBuses — validation', () => {
  // AppError surfaces the specific cause in `.details.reason`, not the
  // message (which is the canned "Invalid input"). We pull both for
  // sharper assertions.
  const reasonOf = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      throw new Error('expected rejection');
    } catch (err) {
      const reason = (err as { details?: { reason?: string }; message?: string }).details?.reason
        ?? (err as Error).message;
      return reason ?? '';
    }
  };

  it('rejects source === destination', async () => {
    expect(
      await reasonOf(searchBuses({ source: 122, destination: 122, doj: '2026-06-15' })),
    ).toMatch(/source and destination must differ/);
  });

  it('rejects non-positive source', async () => {
    expect(
      await reasonOf(searchBuses({ source: 0, destination: 124, doj: '2026-06-15' })),
    ).toMatch(/source/);
  });

  it('rejects malformed doj', async () => {
    await expect(
      searchBuses({ source: 122, destination: 124, doj: '2026/06/15' }),
    ).rejects.toThrow();
  });

  it('rejects impossible doj', async () => {
    await expect(
      searchBuses({ source: 122, destination: 124, doj: '2026-02-30' }),
    ).rejects.toThrow();
  });

  it('rejects doj more than 90 days out', async () => {
    const farFuture = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const yyyy = farFuture.getUTCFullYear();
    const mm = String(farFuture.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(farFuture.getUTCDate()).padStart(2, '0');
    expect(
      await reasonOf(
        searchBuses({ source: 122, destination: 124, doj: `${yyyy}-${mm}-${dd}` }),
      ),
    ).toMatch(/90 days/);
  });
});

describe('searchBuses — policy filtering (Phase 5 wiring)', () => {
  it('drops trips above maxFarePaise', async () => {
    // Mock trip's fareMinINR is 1100 → 110_000 paise. Cap at 100_000.
    const result = await searchBuses({
      source: 122,
      destination: 124,
      doj: '2026-06-15',
      policy: { maxFarePaise: 100_000 },
    });
    expect(result.trips.length).toBe(0);
    expect(result.filteredOut).toBe(1);
  });

  it('keeps trips at or below maxFarePaise', async () => {
    const result = await searchBuses({
      source: 122,
      destination: 124,
      doj: '2026-06-15',
      policy: { maxFarePaise: 200_000 },
    });
    expect(result.trips.length).toBe(1);
    expect(result.filteredOut).toBe(0);
  });

  it('blocks operators on the deny list', async () => {
    const result = await searchBuses({
      source: 122,
      destination: 124,
      doj: '2026-06-15',
      policy: { blockedOperatorIds: [9001] }, // mock trip's operatorId
    });
    expect(result.trips.length).toBe(0);
  });
});

describe('getTripDetails — LIVE every call', () => {
  it('returns parsed forcedSeats + ISO-resolved BP/DP times', async () => {
    const view = await getTripDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    expect(view.forcedSeats.female.length).toBeGreaterThan(0);
    expect(view.forcedSeats.male.length).toBeGreaterThan(0);
    expect(view.boardingPoints[0]!.timeAt).toMatch(/^2026-/);
    expect(view.boardingPoints[0]!.timeMinutes).toBeGreaterThan(0);
  });

  it('hits the SeatSeller client every call (no caching)', async () => {
    // Spy on the mock client's getTripDetails.
    const spy = vi.spyOn(mock, 'getTripDetails');
    await getTripDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    await getTripDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    await getTripDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('throws when the tripId is unknown', async () => {
    await expect(
      getTripDetails('NO-SUCH-TRIP', '2026-06-15'),
    ).rejects.toThrow(SeatSellerError);
  });
});

describe('getBpDpDetails — short cache OK', () => {
  it('caches the BPDP layout (second call does not hit the client)', async () => {
    const spy = vi.spyOn(mock, 'getBpDpDetails');
    await getBpDpDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    await getBpDpDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('resolves stop times to ISO timestamps', async () => {
    const view = await getBpDpDetails('MOCK-TRIP-122-124-2026-06-15', '2026-06-15');
    expect(view.boardingPoints[0]!.timeAt).toMatch(/^2026-/);
    expect(view.droppingPoints[0]!.timeAt).toMatch(/^2026-/);
  });
});

describe('getCityAutocomplete', () => {
  it('lazy-fills the cache on first call', async () => {
    const result = await getCityAutocomplete('bang');
    expect(result.cities.length).toBeGreaterThan(0);
    expect(result.cities.find((c) => c.name === 'Bangalore')).toBeTruthy();
  });

  it('matches alias terms (Bombay → Mumbai)', async () => {
    const result = await getCityAutocomplete('bombay');
    expect(result.cities.find((c) => c.name === 'Mumbai')).toBeTruthy();
  });

  it('returns empty on no match', async () => {
    const result = await getCityAutocomplete('zzzzzz');
    expect(result.cities).toEqual([]);
  });

  it('respects the limit', async () => {
    const result = await getCityAutocomplete('', 2);
    expect(result.cities.length).toBeLessThanOrEqual(2);
  });
});
