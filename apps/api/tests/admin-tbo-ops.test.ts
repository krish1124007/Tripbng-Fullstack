// Pure-function tests for the ops dashboard filter builders.
//
// We exercise:
//   - buildStuckPendingFilter — cutoff math + status filter
//   - buildVoucherDueFilter   — horizon + status + lastCancellationDate range
//   - buildRefundStuckFilter  — debit-set + refund-null marker
//
// All three are pure functions taking a query + (optional) `now` so the
// tests can pin time without faking Date globally.

import { describe, expect, it } from 'vitest';
import {
  buildRefundStuckFilter,
  buildStuckPendingFilter,
  buildVoucherDueFilter,
  type OpsListQuery,
} from '../src/routes/admin-tbo.routes.js';

const baseQuery: OpsListQuery = { page: 1, limit: 50 };
const FIXED_NOW = new Date('2026-05-05T12:00:00.000Z');

describe('buildStuckPendingFilter', () => {
  it('uses 30-minute default cutoff when olderThanMinutes is unset', () => {
    const filter = buildStuckPendingFilter(baseQuery, FIXED_NOW);
    expect(filter.status).toBe('PENDING_SUPPLIER');
    const cutoff = (filter.bookedAt as { $lt: Date }).$lt;
    // 30 minutes before FIXED_NOW
    expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 30 * 60_000);
  });

  it('honours custom olderThanMinutes', () => {
    const filter = buildStuckPendingFilter(
      { ...baseQuery, olderThanMinutes: 90 },
      FIXED_NOW,
    );
    const cutoff = (filter.bookedAt as { $lt: Date }).$lt;
    expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 90 * 60_000);
  });

  it('always pins status to PENDING_SUPPLIER', () => {
    const filter = buildStuckPendingFilter(baseQuery, FIXED_NOW);
    expect(filter.status).toBe('PENDING_SUPPLIER');
  });
});

describe('buildVoucherDueFilter', () => {
  it('uses 24-hour default horizon when withinHours is unset', () => {
    const filter = buildVoucherDueFilter(baseQuery, FIXED_NOW);
    expect(filter.status).toBe('HELD');
    const range = filter.lastCancellationDate as {
      $ne: null;
      $gte: Date;
      $lte: Date;
    };
    expect(range.$gte.getTime()).toBe(FIXED_NOW.getTime()); // not in the past
    expect(range.$lte.getTime()).toBe(FIXED_NOW.getTime() + 24 * 60 * 60_000);
  });

  it('honours custom withinHours horizon', () => {
    const filter = buildVoucherDueFilter(
      { ...baseQuery, withinHours: 6 },
      FIXED_NOW,
    );
    const range = filter.lastCancellationDate as { $lte: Date };
    expect(range.$lte.getTime()).toBe(FIXED_NOW.getTime() + 6 * 60 * 60_000);
  });

  it('excludes bookings with null lastCancellationDate', () => {
    const filter = buildVoucherDueFilter(baseQuery, FIXED_NOW);
    const range = filter.lastCancellationDate as { $ne: null };
    expect(range.$ne).toBeNull();
  });

  it('excludes already-expired cancellation dates ($gte: now)', () => {
    const filter = buildVoucherDueFilter(baseQuery, FIXED_NOW);
    const range = filter.lastCancellationDate as { $gte: Date };
    expect(range.$gte.getTime()).toBe(FIXED_NOW.getTime());
  });
});

describe('buildRefundStuckFilter', () => {
  it('matches BOOK_FAILED rows with debit set + refund null', () => {
    const filter = buildRefundStuckFilter();
    expect(filter).toEqual({
      status: 'BOOK_FAILED',
      walletDebitTxnId: { $ne: null },
      walletRefundTxnId: null,
    });
  });

  it('takes no arguments — pure constant filter', () => {
    expect(buildRefundStuckFilter()).toEqual(buildRefundStuckFilter());
  });
});
