// Crypto helpers shared by payment providers.
//
// PhonePe (V1 legacy): HMAC SHA-256 of `base64(payload) + path + saltKey`,
//   then `${hash}###${saltIndex}` as the X-VERIFY header. V2 uses OAuth bearer
//   tokens — much cleaner — but the legacy path is here for completeness.
//
// PhonePe webhooks (current): SHA-256 of `username:password` in the
//   Authorization header. Plain string compare with timing-safe equal.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ────────── PhonePe ──────────

/** PhonePe V1 X-VERIFY: SHA256(base64(payload) + apiPath + saltKey) + '###' + saltIndex */
export function phonepeXVerifyV1(
  payloadJson: string,
  apiPath: string,
  saltKey: string,
  saltIndex: string,
): { base64Payload: string; xVerify: string } {
  const base64Payload = Buffer.from(payloadJson, 'utf8').toString('base64');
  const hash = createHash('sha256')
    .update(base64Payload + apiPath + saltKey)
    .digest('hex');
  return { base64Payload, xVerify: `${hash}###${saltIndex}` };
}

/** PhonePe webhook auth header: SHA256(username:password). Spec §6.6.
 *  Returns the expected header value; caller compares with timing-safe equal. */
export function phonepeWebhookAuth(username: string, password: string): string {
  return createHash('sha256').update(`${username}:${password}`).digest('hex');
}

/** Constant-time compare for headers / signatures. Mismatched lengths → false. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Convenience: HMAC-SHA256, hex-encoded. */
export function hmacSha256Hex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}
