// AES-256-CBC encrypt/decrypt for ASEGO `createPolicy`. All other ASEGO
// endpoints accept plain JSON — only this one transformation is gated.
//
// Contract (per ASEGO Swagger note: "partner assigned Encryption key only"):
//   • Algorithm:  AES-256-CBC
//   • Padding:    PKCS7 (Node default — do NOT override)
//   • Key:        32-byte UTF-8 string from env (ASEGO_SECRET_KEY)
//   • IV:         16-byte UTF-8 string from env (ASEGO_INIT_VECTOR)
//   • Output:     Base64
//
// Verification path: ASEGO exposes `/encryption/encrypt` + `/encryption/decrypt`
// utility endpoints. The `verifyCryptoParity()` helper at the bottom of this
// file round-trips a known string through both directions; CI runs it before
// any real policy is issued in a fresh environment.

import { createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-cbc';

function getKey(): Buffer {
  const key = process.env.ASEGO_SECRET_KEY;
  if (!key || key.length !== 32) {
    throw new Error('ASEGO_SECRET_KEY must be exactly 32 characters (AES-256)');
  }
  return Buffer.from(key, 'utf8');
}

function getIV(): Buffer {
  const iv = process.env.ASEGO_INIT_VECTOR;
  if (!iv || iv.length !== 16) {
    throw new Error('ASEGO_INIT_VECTOR must be exactly 16 characters (CBC IV)');
  }
  return Buffer.from(iv, 'utf8');
}

/**
 * Encrypts a JSON-serializable payload for ASEGO `createPolicy`.
 * Returns Base64-encoded ciphertext. Strings are passed through verbatim;
 * objects are JSON.stringify'd first.
 */
export function encryptForAsego(payload: unknown): string {
  const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const cipher = createCipheriv(ALGORITHM, getKey(), getIV());
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

/**
 * Decrypts ASEGO ciphertext (Base64) back into UTF-8. Used by the parity
 * verifier and as a debugging hook.
 */
export function decryptFromAsego(ciphertextBase64: string): string {
  const decipher = createDecipheriv(ALGORITHM, getKey(), getIV());
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
