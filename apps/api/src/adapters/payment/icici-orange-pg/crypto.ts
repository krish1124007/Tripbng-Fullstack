// ICICI Orange PG / Pay Gateway — hash calculation helpers.
//
// V1 — used by initiateSale, /command (status/refund/settlement),
//   return URL, payment advice. The `secureHash` field travels inside
//   the JSON/form body.
//   Algorithm:
//     1. Take every param whose value is non-null and non-empty
//        (the `secureHash` field itself is always excluded).
//     2. Sort by parameter NAME alphabetically ascending.
//     3. Concatenate the VALUES (not key=value pairs) in that order.
//     4. HMAC-SHA256 with the merchant key as the secret.
//     5. Hex, lowercase.
//
// V2 — used by userCancel, getCardBin, getServiceCharges. The hash
//   travels in the `securehash` HTTP header (lowercase). The body is
//   stringified verbatim (minified JSON).
//   Algorithm:
//     1. JSON.stringify the body in minified form (no whitespace).
//     2. HMAC-SHA256 with the merchant key.
//     3. Hex, lowercase.
//     4. Send in lowercase header `securehash`.
//
// Golden vector (PDF v0.4, page 6) is enforced in crypto.test.ts —
// do not refactor this file without re-running that test.

import { createHmac } from 'node:crypto';

/** Drop the `secureHash` field and any null/undefined/empty-string values
 *  before hashing. Defensive copy — callers can pass the original object. */
function hashableEntries(params: object): Array<[string, string]> {
  return Object.entries(params as Record<string, unknown>)
    .filter(([k, v]) => {
      if (k === 'secureHash') return false;
      if (v === null || v === undefined) return false;
      if (typeof v === 'string' && v.length === 0) return false;
      return true;
    })
    .map(([k, v]) => [k, String(v)] as [string, string]);
}

/** Build the exact "HashText" string the spec documents — sorted-by-key values
 *  concatenated. Exposed so tests can verify the intermediate matches the
 *  reference doc, separately from the HMAC step. */
export function buildHashText(params: object): string {
  const sorted = hashableEntries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted.map(([, v]) => v).join('');
}

/** V1: concat values of non-empty params sorted by key, HMAC-SHA256, hex-lowercase. */
export function secureHashV1(params: object, key: string): string {
  return createHmac('sha256', key).update(buildHashText(params), 'utf8').digest('hex');
}

/** Verify a V1-hashed payload. Returns true iff the supplied secureHash
 *  matches the recomputed hash over the rest of the params. */
export function verifySecureHashV1(
  params: object,
  key: string,
  supplied: string | undefined | null,
): boolean {
  if (!supplied) return false;
  const expected = secureHashV1(params, key);
  // Length-equal hex compare — short-circuit on length mismatch is fine here
  // since the inputs are public-side (the attacker already knows the body).
  if (expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ supplied.toLowerCase().charCodeAt(i);
  }
  return diff === 0;
}

/** V2: HMAC-SHA256 of the minified JSON body, hex-lowercase.
 *  Caller is responsible for sending this in the `securehash` HTTP header. */
export function secureHashV2(body: unknown, key: string): string {
  const message = JSON.stringify(body);
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}
