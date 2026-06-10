// HolidaySupplierRegistry — single source of truth for which adapter
// handles which supplier code. Mirrors the flight adapter registry
// (adapters/registry.ts) but typed per holiday.
//
// Construction is lazy + memoised — adapters that need env-configured
// credentials (TBO_HOLIDAYS_*) are only instantiated when first asked
// for. Tests inject overrides via `_setHolidaySupplier` for isolation.

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MockHolidayAdapter } from './mock-holiday.adapter.js';
import { TBOHolidaysAdapter } from './tbo-holidays.adapter.js';
import {
  HolidayAdapterError,
  type HolidaySupplierAdapter,
  type HolidaySupplierCode,
} from './types.js';

const cache = new Map<HolidaySupplierCode, HolidaySupplierAdapter>();

/**
 * Resolve a supplier adapter by code. Throws `NOT_CONFIGURED` for real
 * suppliers whose env flag is off — the caller decides whether to
 * fall back to MOCK or surface the error to ops.
 */
export function holidaySupplier(code: HolidaySupplierCode): HolidaySupplierAdapter {
  const cached = cache.get(code);
  if (cached) return cached;

  let adapter: HolidaySupplierAdapter;
  switch (code) {
    case 'MOCK_HOLIDAYS':
    case 'CUSTOM':
      // CUSTOM is the catch-all for admin-authored packages where the
      // platform itself is the supplier of record. Treated identically to
      // MOCK_HOLIDAYS until a dedicated "platform-authored" adapter ships.
      adapter = new MockHolidayAdapter();
      break;

    case 'TBO_HOLIDAYS':
      if (!env.TBO_HOLIDAYS_ENABLED) {
        throw new HolidayAdapterError(
          'NOT_CONFIGURED',
          'TBO Holidays adapter is disabled — set TBO_HOLIDAYS_ENABLED=true and provision credentials',
          code,
        );
      }
      adapter = new TBOHolidaysAdapter();
      break;

    default: {
      // Exhaustiveness check.
      const _: never = code;
      throw new HolidayAdapterError(
        'NOT_CONFIGURED',
        `unknown holiday supplier code ${String(_)}`,
        'MOCK_HOLIDAYS',
      );
    }
  }

  cache.set(code, adapter);
  return adapter;
}

/**
 * Default supplier — `MOCK_HOLIDAYS` unless TBO is wired AND the caller
 * doesn't override via Map Source / agency config. Most callers route via
 * the package's own `supplierCode` discriminator; this default is the
 * fallback for legacy code paths that haven't been migrated yet.
 */
export function defaultHolidaySupplier(): HolidaySupplierAdapter {
  return holidaySupplier('MOCK_HOLIDAYS');
}

/** Test helper — swap an adapter instance for the given code. Calls
 *  during normal runtime are forbidden (production should always go via
 *  `holidaySupplier`); tests use it to inject in-memory stubs. */
export function _setHolidaySupplier(
  code: HolidaySupplierCode,
  adapter: HolidaySupplierAdapter,
): void {
  cache.set(code, adapter);
  logger.debug({ code }, '_setHolidaySupplier — adapter overridden (test path only)');
}

/** Test helper — clear the cache so the next `holidaySupplier` call
 *  reconstructs from scratch. Used in beforeEach. */
export function _resetHolidayRegistry(): void {
  cache.clear();
}
