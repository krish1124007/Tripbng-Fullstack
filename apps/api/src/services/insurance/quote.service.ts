// Live priced quote — `GET /plan/{partnerId}?duration=&age=&category=`.
// Never cached (pricing is per-traveler-age-and-duration so a cache hit would
// be technically incorrect at the per-quote level).
//
// We accept a single age + duration today (sufficient for the React UI's first
// cut). For group quotes the frontend can issue one quote per traveler-age and
// the mapper later builds a single `createPolicy` array spanning all of them.

import { AppError } from '@tripbng/shared';
import { getAsegoContext } from './asego.singleton.js';

export interface QuoteParams {
  /** trip duration in days, must equal endDate - startDate */
  duration: number;
  /** traveler age (1-80; 80+ is a separate plan family per ASEGO) */
  age: number;
  /** category UUID from /category master */
  category: string;
  /** optional destination string (used by some plans for display) */
  destination?: string;
}

export async function fetchQuote(params: QuoteParams): Promise<unknown> {
  const ctx = getAsegoContext();
  if (!ctx) {
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO insurance not configured' });
  }
  if (!params.category) {
    throw new AppError('VALIDATION_ERROR', { reason: 'category required' });
  }
  if (params.duration < 1 || params.duration > 365) {
    throw new AppError('VALIDATION_ERROR', { reason: 'duration must be 1–365 days' });
  }
  if (params.age < 1 || params.age > 80) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'age must be 1–80 (use senior plan family for 80+)',
    });
  }

  return await ctx.client.get<unknown>(`/plan/${ctx.identity.partnerId}`, {
    duration: params.duration,
    age: params.age,
    category: params.category,
    destination: params.destination,
  });
}
