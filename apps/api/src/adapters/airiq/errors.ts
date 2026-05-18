// AirIQ error mapper.
//
// AirIQ's spec doesn't ship a numeric error-code dictionary — failures arrive as
// `Status.ResultCode = 0 | -1` plus an `Error` string. We pattern-match the
// string to a category. As we capture real failure messages from the test
// endpoint, add them here — keep entries grouped by category for readability.

import { SupplierAdapterError, type SupplierAdapter } from '../types.js';

export interface AirIQErrorMapping {
  category: 'AUTH' | 'BAD_REQUEST' | 'NOT_FOUND' | 'EXHAUSTED' | 'UPSTREAM';
  userMessage: string;
  /** Is the call safe to retry as-is (without restarting the funnel)? */
  retryable: boolean;
}

/** Doc-confirmed: any response with this exact substring needs a token refresh. */
export const TOKEN_TIMEOUT_MARKER = 'token was timed out';

const PATTERNS: { match: RegExp; mapping: AirIQErrorMapping }[] = [
  // Auth
  {
    match: /token\s*was\s*timed\s*out/i,
    mapping: {
      category: 'AUTH',
      userMessage: 'AirIQ session expired. Refreshing token and retrying.',
      retryable: true,
    },
  },
  {
    // Confirmed against the test endpoint: "Your requested IP address is Invalid. (01)".
    match: /ip\s*address\s*is\s*invalid/i,
    mapping: {
      category: 'AUTH',
      userMessage: 'AirIQ IP not whitelisted. Send your egress IP to gagansareen@airiq.in.',
      retryable: false,
    },
  },
  {
    match: /invalid\s*(credential|username|password|agent)/i,
    mapping: {
      category: 'AUTH',
      userMessage: 'AirIQ authentication failed. Check credentials with the trade desk.',
      retryable: false,
    },
  },
  // Validation
  {
    match: /(invalid|missing)\s*(date|airline|airport|sector|passenger|adult|child|infant)/i,
    mapping: {
      category: 'BAD_REQUEST',
      userMessage: 'AirIQ rejected the request — check sector, date, and passenger counts.',
      retryable: false,
    },
  },
  // Availability gone
  {
    match: /(no\s*flight|sold\s*out|not\s*available|fare\s*expired)/i,
    mapping: {
      category: 'EXHAUSTED',
      userMessage: 'AirIQ has no flights matching these criteria. Try a different date or sector.',
      retryable: false,
    },
  },
];

const DEFAULT_MAPPING: AirIQErrorMapping = {
  category: 'UPSTREAM',
  userMessage: 'AirIQ reported an unexpected error. Please retry or contact support.',
  retryable: true,
};

/** Pattern-match an AirIQ Error string + ResultCode into our internal category.
 *  ResultCode arrives as a JSON string per the live response shape. */
export function mapAirIQError(resultCode: string, errorDesc: string): AirIQErrorMapping {
  if (resultCode === '-1') {
    // Server exception — different category from a clean validation failure.
    return {
      category: 'UPSTREAM',
      userMessage: 'AirIQ reported a server-side error. Try again in a moment.',
      retryable: true,
    };
  }
  for (const { match, mapping } of PATTERNS) {
    if (match.test(errorDesc)) {
      return mapping;
    }
  }
  return { ...DEFAULT_MAPPING, userMessage: errorDesc || DEFAULT_MAPPING.userMessage };
}

/** Throw a typed SupplierAdapterError with the correct category. */
export function throwAsSupplierError(
  resultCode: string,
  errorDesc: string,
  sequenceId: string | undefined,
  supplier: Pick<SupplierAdapter, 'code'>,
): never {
  const m = mapAirIQError(resultCode, errorDesc);
  const seq = sequenceId ? ` (SeqID ${sequenceId})` : '';
  throw new SupplierAdapterError(
    m.category,
    m.userMessage || `[AirIQ rc=${resultCode}] ${errorDesc}${seq}`,
    supplier.code,
  );
}
