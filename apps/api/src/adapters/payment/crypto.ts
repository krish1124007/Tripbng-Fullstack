// Crypto helpers shared by payment providers.
//
// ICICI Eazypay: AES-128 ECB, PKCS7 padding, hex-encoded UPPERCASE output.
//   - Key: 16-char string from the merchant config (NO derivation, NO IV).
//   - Each parameter is encrypted SEPARATELY (not the whole body).
//
// PhonePe (V1 legacy): HMAC SHA-256 of `base64(payload) + path + saltKey`,
//   then `${hash}###${saltIndex}` as the X-VERIFY header. V2 uses OAuth bearer
//   tokens — much cleaner — but the legacy path is here for completeness.
//
// PhonePe webhooks (current): SHA-256 of `username:password` in the
//   Authorization header. Plain string compare with timing-safe equal.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

// ────────── ICICI Eazypay ──────────

/** AES-128 ECB encrypt of a single field, returned as UPPERCASE hex.
 *  Eazypay does NOT use base64 — using base64 here causes silent gateway
 *  rejection with no useful error code. */
export function eazypayEncrypt(plaintext: string, encryptionKey: string): string {
  if (encryptionKey.length !== 16) {
    throw new Error('eazypay encryption key must be exactly 16 chars');
  }
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(encryptionKey, 'utf8'), null);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return encrypted.toString('hex').toUpperCase();
}

/** Decrypt an Eazypay return field (hex → UTF-8 plaintext). */
export function eazypayDecrypt(hex: string, encryptionKey: string): string {
  if (encryptionKey.length !== 16) {
    throw new Error('eazypay encryption key must be exactly 16 chars');
  }
  const decipher = createDecipheriv('aes-128-ecb', Buffer.from(encryptionKey, 'utf8'), null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(hex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Build Eazypay's pipe-delimited mandatory fields:
 *  `referenceNo|subMerchantId|amount` — amount in rupees with 2 decimals. */
export function eazypayMandatoryFields(
  referenceNo: string,
  subMerchantId: string,
  amountPaise: number,
): string {
  const amountRupees = (amountPaise / 100).toFixed(2);
  return `${referenceNo}|${subMerchantId}|${amountRupees}`;
}

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
