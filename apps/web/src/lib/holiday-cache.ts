import type { HolidayPackage, HolidaySearchResponse } from '@tripbng/shared';

// Session-scoped cache for holiday search results so the detail page
// (`/holidays/[id]`) can read a package by id without re-searching. The
// backend doesn't ship a `GET /api/v1/holidays/:id` endpoint yet — when a DMC
// or holiday-wholesaler integration ships one, swap this for a real query and
// delete the cache module.

const KEY = 'tripbng:holiday-search-cache';

interface CachedSearch {
  searchId: string;
  results: HolidayPackage[];
  destination: string;
  duration: string;
  travellers: string;
  budget: string;
  theme: string;
  departure: string;
  cachedAt: number;
}

const TTL_MS = 30 * 60 * 1000;

export function writeHolidaySearchCache(value: Omit<CachedSearch, 'cachedAt'>): void {
  if (typeof window === 'undefined') return;
  const payload: CachedSearch = { ...value, cachedAt: Date.now() };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can throw in incognito / quota-exceeded — silently drop.
  }
}

export function readHolidaySearchCache(): CachedSearch | null {
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

export function findHolidayInCache(
  id: string,
): { pkg: HolidayPackage; cache: CachedSearch } | null {
  const cache = readHolidaySearchCache();
  if (!cache) return null;
  const pkg = cache.results.find((p) => p.id === id);
  if (!pkg) return null;
  return { pkg, cache };
}

export function clearHolidaySearchCache(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(KEY);
}

export function adaptResponseToCache(
  response: HolidaySearchResponse,
  query: {
    destination: string;
    duration: string;
    travellers: string;
    budget: string;
    theme: string;
    departure: string;
  },
): Omit<CachedSearch, 'cachedAt'> {
  return {
    searchId: response.searchId,
    results: response.results,
    ...query,
  };
}
