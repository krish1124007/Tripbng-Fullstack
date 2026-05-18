import type { InsurancePlan, InsuranceQuoteResponse } from '@tripbng/shared';

// Session-scoped cache for insurance plans so the detail page
// (`/insurance/[planId]`) can read a plan by id without re-quoting. The
// backend doesn't ship a `GET /api/v1/insurance/:planId` endpoint yet — when
// a real carrier integration (Tata AIG / ICICI Lombard / ACKO) ships one,
// swap this for a real query and delete the cache module.

const KEY = 'tripbng:insurance-quote-cache';

interface CachedQuote {
  searchId: string;
  plans: InsurancePlan[];
  tripType: string;
  region: string;
  from: string;
  to: string;
  travellers: string;
  oldestAge: string;
  cachedAt: number;
}

const TTL_MS = 30 * 60 * 1000;

export function writeInsuranceQuoteCache(value: Omit<CachedQuote, 'cachedAt'>): void {
  if (typeof window === 'undefined') return;
  const payload: CachedQuote = { ...value, cachedAt: Date.now() };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can throw in incognito / quota-exceeded — silently drop.
  }
}

export function readInsuranceQuoteCache(): CachedQuote | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedQuote;
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function findInsurancePlanInCache(
  planId: string,
): { plan: InsurancePlan; cache: CachedQuote } | null {
  const cache = readInsuranceQuoteCache();
  if (!cache) return null;
  const plan = cache.plans.find((p) => p.id === planId);
  if (!plan) return null;
  return { plan, cache };
}

export function clearInsuranceQuoteCache(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(KEY);
}

export function adaptResponseToCache(
  response: InsuranceQuoteResponse,
  query: {
    tripType: string;
    region: string;
    from: string;
    to: string;
    travellers: string;
    oldestAge: string;
  },
): Omit<CachedQuote, 'cachedAt'> {
  return {
    searchId: response.searchId,
    plans: response.plans,
    ...query,
  };
}
