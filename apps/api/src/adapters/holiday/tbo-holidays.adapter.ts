// TBOHolidaysAdapter — placeholder for the TBO Holidays API integration.
//
// Status: SKELETON. Throws NOT_IMPLEMENTED on every method. Reasons:
//   1. TBO Holidays API spec not yet delivered by their account team.
//   2. TBO_HOLIDAYS_USERNAME / TBO_HOLIDAYS_PASSWORD env vars not yet
//      provisioned on production. (TBO Hotels uses TBO_HOTEL_USERNAME /
//      TBO_HOTEL_PASSWORD — Holidays is a separate API surface that may
//      use a third credential set.)
//
// When the spec lands:
//   1. Fill in `search()` against the holiday-search endpoint (likely
//      POST /Holidays/SearchPackages with origin city + destination +
//      dates + pax mix).
//   2. Fill in `priceCheck()` — TBO typically requires a pre-book call
//      to re-validate availability + price (refresh the supplierQuoteRef).
//   3. Fill in `book()` against the holiday-book endpoint. Pass through
//      our internal bookingCode as `BookingReference` so the supplier's
//      logs cross-reference.
//   4. Fill in `cancel()` + `fetchStatus()` — TBO holidays cancellation
//      is asynchronous (queues a change request), so fetchStatus polls
//      until terminal.
//
// See apps/api/src/adapters/holiday/EMAIL_DRAFT.md for the exact list of
// open questions on the integration.
//
// Pattern mirror: apps/api/src/adapters/etrav/etrav.adapter.ts and
// apps/api/src/adapters/airiq/airiq.adapter.ts — both lived as skeletons
// for a while before specs landed.

import type { HolidayPackage, HolidaySearchRequest } from '@tripbng/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  HolidayAdapterError,
  type HolidayBookRequest,
  type HolidayBookResponse,
  type HolidayBookingStatus,
  type HolidayCancelRequest,
  type HolidayCancelResponse,
  type HolidayCapability,
  type HolidayPriceCheckRequest,
  type HolidayPriceCheckResponse,
  type HolidaySupplierAdapter,
  type HolidaySupplierCode,
} from './types.js';

const NOT_IMPLEMENTED =
  'TBO Holidays adapter not yet implemented — spec pending from TBO account manager. ' +
  'See apps/api/src/adapters/holiday/EMAIL_DRAFT.md.';

export class TBOHolidaysAdapter implements HolidaySupplierAdapter {
  readonly code: HolidaySupplierCode = 'TBO_HOLIDAYS';
  readonly name = 'TBO Holidays';
  // Empty capability list until methods get wired. Booking flows that
  // consult `capabilities` first will know to fall back / refuse cleanly.
  readonly capabilities: readonly HolidayCapability[] = [];

  constructor() {
    // Surface a one-time warning in logs so deployments don't silently
    // run with a dead adapter. The registry has already verified the
    // env flag is on, so this means "operator enabled it but the code
    // path will throw on every call".
    logger.warn(
      {
        adapter: 'TBO_HOLIDAYS',
        username: env.TBO_HOLIDAYS_USERNAME ? '(set)' : '(unset)',
        password: env.TBO_HOLIDAYS_PASSWORD ? '(set)' : '(unset)',
        baseUrl: env.TBO_HOLIDAYS_BASE_URL ?? '(unset)',
      },
      'TBO Holidays adapter instantiated as SKELETON — every method throws NOT_IMPLEMENTED',
    );
  }

  async search(_req: HolidaySearchRequest): Promise<HolidayPackage[]> {
    throw new HolidayAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async priceCheck(_req: HolidayPriceCheckRequest): Promise<HolidayPriceCheckResponse> {
    throw new HolidayAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async book(_req: HolidayBookRequest): Promise<HolidayBookResponse> {
    throw new HolidayAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async cancel(_req: HolidayCancelRequest): Promise<HolidayCancelResponse> {
    throw new HolidayAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async fetchStatus(_supplierBookingRef: string): Promise<HolidayBookingStatus> {
    throw new HolidayAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }
}
