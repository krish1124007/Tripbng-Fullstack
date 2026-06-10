// Orange PG (ICICI pgpay) hash helpers — Interface Spec §"Hash Calculation".
//
// V1 (form params / command APIs):
//   1. Concatenate the parameter VALUES (skip null/empty, and skip secureHash
//      itself) in ASCENDING order of parameter NAME.
//   2. HMAC-SHA256 with the merchant secret key.
//   3. Hex, lowercase → `secureHash`.
//
// V2 (JSON request/response bodies):
//   1. Minified JSON string of the body.
//   2. HMAC-SHA256 with the secret key → hex lowercase → `securehash` HTTP header.

import crypto from 'node:crypto';

/** V1 hash over a flat param map (used by the return URL + /command APIs). */
export function orangeHashV1(
  params: Record<string, string | number | null | undefined>,
  secretKey: string,
): string {
  const message = Object.keys(params)
    .filter((k) => k !== 'secureHash' && k !== 'securehash')
    .filter((k) => params[k] !== null && params[k] !== undefined && String(params[k]) !== '')
    .sort()
    .map((k) => String(params[k]))
    .join('');
  return crypto.createHmac('sha256', secretKey).update(message, 'utf8').digest('hex').toLowerCase();
}

/** Constant-time compare of a received V1 hash against the recomputed one. */
export function orangeVerifyV1(
  params: Record<string, string | number | null | undefined>,
  secretKey: string,
): boolean {
  const received = String(params['secureHash'] ?? '').toLowerCase();
  if (!received) return false;
  const computed = orangeHashV1(params, secretKey);
  if (received.length !== computed.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(computed));
  } catch {
    return false;
  }
}

/** V2 hash over a minified JSON string (sent in the `securehash` request header). */
export function orangeHashV2(minifiedJson: string, secretKey: string): string {
  return crypto.createHmac('sha256', secretKey).update(minifiedJson, 'utf8').digest('hex').toLowerCase();
}
