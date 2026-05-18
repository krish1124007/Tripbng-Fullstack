import type { HotelOption, HotelSearchResponse } from '@tripbng/shared';

// Session-scoped cache for hotel search results, so the detail page (`/hotels/[id]`)
// can read a hotel by id without re-searching. The backend doesn't ship a
// `GET /api/v1/hotels/:id` endpoint yet — when the real Hotelbeds/Travelport
// integration adds one, swap this for a proper query and delete the cache.

const KEY = 'tripbng:hotel-search-cache';

interface CachedSearch {
  searchId: string;
  results: HotelOption[];
  /** Original search query — surfaced on the detail page header. */
  destination: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
  nationality: string;
  /** Epoch ms — used to expire stale caches after 30 minutes. */
  cachedAt: number;
}

const TTL_MS = 30 * 60 * 1000;

export function writeHotelSearchCache(value: Omit<CachedSearch, 'cachedAt'>): void {
  if (typeof window === 'undefined') return;
  const payload: CachedSearch = { ...value, cachedAt: Date.now() };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can throw in incognito / quota-exceeded — silently drop.
  }
}

export function readHotelSearchCache(): CachedSearch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSearch;
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function findHotelInCache(id: string): { hotel: HotelOption; cache: CachedSearch } | null {
  const cache = readHotelSearchCache();
  if (!cache) return null;
  const hotel = cache.results.find((h) => h.id === id);
  if (!hotel) return null;
  return { hotel, cache };
}

/** For tests / sign-out flows. */
export function clearHotelSearchCache(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(KEY);
}

export function adaptResponseToCache(
  response: HotelSearchResponse,
  query: { destination: string; checkIn: string; checkOut: string; rooms: number; guests: number; nationality: string },
): Omit<CachedSearch, 'cachedAt'> {
  return {
    searchId: response.searchId,
    results: response.results,
    ...query,
  };
}
