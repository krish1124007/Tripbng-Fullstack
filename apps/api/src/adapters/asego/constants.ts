// Static lookups for the ASEGO contract — keep here so they're searchable and
// don't drift across files.

/**
 * ASEGO error codes observed against the dolphin sandbox + OpenAPI examples.
 * Each entry maps to a clean, user-safe message and a retry hint:
 *
 *   `retry: 'transient'` — try again automatically (5xx / network)
 *   `retry: 'never'`     — fix the input, retrying won't help
 *   `retry: 'support'`   — needs ASEGO ops involvement
 *
 * The full list is incomplete (ASEGO has more codes we haven't seen yet); the
 * `unknown` fallback returns ASEGO's raw `msg` verbatim so users still see
 * something actionable.
 */
export const ASEGO_ERROR_CATALOG: Record<
  string,
  { message: string; retry: 'transient' | 'never' | 'support' }
> = {
  '100': { message: 'Insurance partner mis-configured. Reach out to support.', retry: 'support' },
  '106': { message: 'No policy data received by the insurer.', retry: 'never' },
  '107': { message: 'Policy data did not match the insurer schema.', retry: 'never' },
  '116': { message: 'Plan details missing from request.', retry: 'never' },
  '117': { message: 'Selected plan id is missing.', retry: 'never' },
  '127': { message: 'Selected plan block is missing or empty.', retry: 'never' },
  '130': { message: 'Other-details block is missing.', retry: 'never' },
  '132': { message: 'Travel category is missing.', retry: 'never' },
  '143': { message: 'Traveller district is missing.', retry: 'never' },
  '146': { message: 'Traveller country is missing.', retry: 'never' },
  '152': { message: 'Nominee relation is missing.', retry: 'never' },
  '159': { message: 'Insurer rejected the request — please verify all details.', retry: 'support' },
  '163': { message: 'Policy not found or already in a final state.', retry: 'never' },
  // Backwards-compat alias for older docs that prefixed codes with `e`.
  e100: { message: 'Insurance partner mis-configured. Reach out to support.', retry: 'support' },
};

export const ASEGO_ERROR_CODE = {
  PartnerIdMissing: 'e100',
} as const;

/** Lookup helper. Falls through to the raw msg when ASEGO returns a code we
 *  haven't catalogued yet — better than swallowing the message entirely. */
export function describeAsegoError(
  code: string | undefined,
  rawMsg: string,
): { message: string; retry: 'transient' | 'never' | 'support' } {
  if (code && ASEGO_ERROR_CATALOG[code]) return ASEGO_ERROR_CATALOG[code]!;
  // Generic HTTP_5xx codes from our client — always treat as transient.
  if (code?.startsWith('HTTP_5')) {
    return { message: rawMsg || 'Insurer is having issues, please try again.', retry: 'transient' };
  }
  if (code === 'TRANSPORT_ERROR') {
    return { message: 'Cannot reach the insurer right now.', retry: 'transient' };
  }
  return { message: rawMsg || 'Insurance request failed.', retry: 'never' };
}

/** Rider rate types — drives premium calculation in the mapper. */
export const ASEGO_RATE_TYPE = {
  /** percent of age premium → riderAmount = agePremium * value / 100 */
  Loading: 'Loading %',
  /** absolute uuid keyed value pulled from master plan data */
  Value: 'Rider Value',
} as const;
export type AsegoRateType = (typeof ASEGO_RATE_TYPE)[keyof typeof ASEGO_RATE_TYPE];

/** Reason-list types we expect the frontend to pass to /reasons/{type}. */
export const ASEGO_REASON_TYPE = ['cancellation', 'endorsement'] as const;
export type AsegoReasonType = (typeof ASEGO_REASON_TYPE)[number];
