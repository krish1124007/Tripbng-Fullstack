// Centralised regex helpers for query-time string matching.
//
// Mongo route handlers compose `new RegExp(userInput, 'i')` against indexed
// string fields all over the place. Without escaping:
//   1. ReDoS — adversarial inputs like "(a+)+$" lock the query thread until
//      Node's regex backtracker gives up.
//   2. Regex injection — characters like `.*` and `^` change the intent of
//      the filter; users who type a literal period get every row.
//
// Always pass user-supplied strings through `escapeRegex` before wrapping
// them in `new RegExp`. Routes that want partial matching get the
// `containsRegex` helper; routes that want prefix matching get
// `prefixRegex`. Both clamp the input length so we don't even try to compile
// pathologically long patterns.

const MAX_QUERY_LEN = 200;

/**
 * Escape every regex metacharacter in `input` so it matches literally when
 * passed to `new RegExp`. Same shape as MDN's recommended escape; matches
 * the duplicated `escapeRegExp` helpers in holidayPackage.service.ts /
 * visaProduct.service.ts which this file consolidates.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive substring matcher for a user query. Returns null
 * when the trimmed input is empty so callers can guard with
 * `if (!re)` and skip the filter entirely.
 */
export function containsRegex(input: string | null | undefined, flags = 'i'): RegExp | null {
  if (!input) return null;
  const trimmed = input.trim().slice(0, MAX_QUERY_LEN);
  if (!trimmed) return null;
  return new RegExp(escapeRegex(trimmed), flags);
}

/**
 * Build a prefix matcher (`^...`) for a user query. Same length clamp +
 * escape as `containsRegex`. Returns null for empty input.
 */
export function prefixRegex(input: string | null | undefined, flags?: string): RegExp | null {
  if (!input) return null;
  const trimmed = input.trim().slice(0, MAX_QUERY_LEN);
  if (!trimmed) return null;
  return new RegExp(`^${escapeRegex(trimmed)}`, flags);
}
