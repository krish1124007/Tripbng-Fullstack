// eTrav error code mapper.
//
// The full error dictionary is one of the open questions for the eTrav account
// manager (analysis §7.5 q16). Until they send it, we map a small set of known
// codes and route everything else to a generic UPSTREAM error. As we learn
// codes from real responses, add them here — keep the entries grouped by
// category for readability.

import { SupplierAdapterError, type SupplierAdapter } from '../types.js';

export interface EtravErrorMapping {
  /** Internal error category that maps to our SupplierAdapterError code. */
  category:
    | 'AUTH'
    | 'BAD_REQUEST'
    | 'NOT_FOUND'
    | 'EXHAUSTED' // session/seats/availability gone
    | 'UPSTREAM'; // generic supplier failure
  /** User-friendly message safe to surface in toasts / dialogs. */
  userMessage: string;
  /** Whether the operation is safe to retry as-is (without re-running the funnel). */
  retryable: boolean;
}

// Best-guess mapping based on conventional aggregator codes + analysis hints.
// These will be confirmed against real responses during integration testing.
const KNOWN: Record<string, EtravErrorMapping> = {
  '0000': {
    category: 'UPSTREAM',
    userMessage: '',
    retryable: false,
  },
  // Auth / agent setup
  '1001': {
    category: 'AUTH',
    userMessage: 'eTrav authentication failed. Check credentials with the trade desk.',
    retryable: false,
  },
  '1002': {
    category: 'AUTH',
    userMessage: 'eTrav IP not whitelisted. Contact account manager.',
    retryable: false,
  },
  // Search / availability
  '2001': {
    category: 'EXHAUSTED',
    userMessage: 'No flights returned for these criteria. Try a different date or sector.',
    retryable: false,
  },
  '2002': {
    category: 'EXHAUSTED',
    userMessage: 'Search session expired. Run the search again to refresh fares.',
    retryable: false,
  },
  // Reprice / fare changed
  '3001': {
    category: 'EXHAUSTED',
    userMessage: 'Fare no longer available — please re-search.',
    retryable: false,
  },
  '3002': {
    category: 'EXHAUSTED',
    userMessage: 'Price has changed since search. Confirm the new total before booking.',
    retryable: false,
  },
  // Generic supplier
  '9999': {
    category: 'UPSTREAM',
    userMessage: 'eTrav reported an upstream issue. Try again in a moment.',
    retryable: true,
  },
};

const DEFAULT_MAPPING: EtravErrorMapping = {
  category: 'UPSTREAM',
  userMessage: 'eTrav reported an unexpected error. Please retry or contact support.',
  retryable: true,
};

export function mapEtravError(errorCode: string, errorDesc: string): EtravErrorMapping {
  const known = KNOWN[errorCode];
  if (!known) {
    return {
      ...DEFAULT_MAPPING,
      // Surface eTrav's own description if we don't know better.
      userMessage: errorDesc || DEFAULT_MAPPING.userMessage,
    };
  }
  return known;
}

/** Throw a typed SupplierAdapterError with the right category. */
export function throwAsSupplierError(
  errorCode: string,
  errorDesc: string,
  supplier: Pick<SupplierAdapter, 'code'>,
): never {
  const m = mapEtravError(errorCode, errorDesc);
  throw new SupplierAdapterError(
    m.category,
    m.userMessage || `[eTrav ${errorCode}] ${errorDesc}`,
    supplier.code,
  );
}
