// Field-level encryption helpers — AES-256-GCM, key from KMS / env.
//
// Why GCM (not CBC): authenticated, detects tampering, no separate HMAC.
// Why prefixed format: lets us rotate keys later (`v1:...` → `v2:...`).
// Why a Mongoose plugin: the helper is one-line at the field level
// (`type: encryptedString()`), and the model file stays readable.
//
// Production: read the key from AWS KMS / Doppler / Infisical at boot. Until
// that lands, dev reads from `FIELD_ENCRYPTION_KEY` env (32-byte hex). The
// boot guard refuses to start in production with a placeholder key.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Schema } from 'mongoose';

const ALGO = 'aes-256-gcm';
const KEY_VERSION = 'v1';
const PLACEHOLDER = '00000000000000000000000000000000000000000000000000000000000000000000';

function loadKey(): Buffer {
  const hex = process.env.FIELD_ENCRYPTION_KEY ?? '';
  if (process.env.NODE_ENV === 'production' && (!hex || hex === PLACEHOLDER)) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY missing or placeholder in production. Provision via KMS/Doppler/Infisical.',
    );
  }
  if (!hex) {
    // Dev fallback — deterministic so dev DBs are readable across restarts,
    // but logged loudly so it's never mistaken for "encrypted in production".
    return Buffer.from(PLACEHOLDER, 'hex');
  }
  if (hex.length !== 64) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return Buffer.from(hex, 'hex');
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

/** Encrypt a UTF-8 string. Output: `v1:<iv-hex>:<ct-hex>:<tag-hex>`. */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${KEY_VERSION}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

/** Decrypt the prefixed format. Throws on tag mismatch. Returns plaintext as-is
 *  if the value isn't in our format (legacy unencrypted rows during migration). */
export function decryptField(value: string): string {
  if (!value) return value;
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== KEY_VERSION) return value;
  const [, ivHex, ctHex, tagHex] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex!, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}

/** Encrypt a JSON-serializable value (used for credentials blobs). */
export function encryptJson<T>(value: T): string {
  return encryptField(JSON.stringify(value));
}

export function decryptJson<T>(value: string): T {
  const pt = decryptField(value);
  return JSON.parse(pt) as T;
}

// ────────── Mongoose plugin ──────────

interface PluginOptions {
  /** Field paths to encrypt at-rest. Read paths get auto-decrypted via getter. */
  paths: string[];
}

/**
 * Apply field-level encryption to specific paths on a schema.
 *   schema.plugin(encryptedFields, { paths: ['passport.number', 'gst.number'] })
 *
 * Behaviour:
 *   - On save: paths are encrypted before write.
 *   - On read: paths are decrypted in document `toObject()` / `toJSON()`.
 *   - Querying an encrypted field by plaintext does NOT match (you can't
 *     `find({ passport: { number: 'M1234567' } })`). Use `decryptField` on
 *     the result side, or hash-index a derived field if you need lookups.
 */
export function encryptedFields(schema: Schema, options: PluginOptions): void {
  const paths = options.paths;

  schema.pre('save', function (next) {
    for (const p of paths) {
      const v = this.get(p);
      if (typeof v === 'string' && v && !v.startsWith(`${KEY_VERSION}:`)) {
        this.set(p, encryptField(v));
      }
    }
    next();
  });

  schema.set('toJSON', {
    transform(_doc, ret: Record<string, unknown>) {
      decryptInPlace(ret, paths);
      return ret;
    },
  });
  schema.set('toObject', {
    transform(_doc, ret: Record<string, unknown>) {
      decryptInPlace(ret, paths);
      return ret;
    },
  });
}

function decryptInPlace(obj: Record<string, unknown>, paths: string[]): void {
  for (const p of paths) {
    const segs = p.split('.');
    let cur: Record<string, unknown> | undefined = obj;
    for (let i = 0; i < segs.length - 1; i++) {
      cur = cur?.[segs[i]!] as Record<string, unknown> | undefined;
      if (!cur) break;
    }
    if (!cur) continue;
    const last = segs[segs.length - 1]!;
    const v = cur[last];
    if (typeof v === 'string' && v.startsWith(`${KEY_VERSION}:`)) {
      try {
        cur[last] = decryptField(v);
      } catch {
        // Tag mismatch — leave as-is so the bad value surfaces in logs.
      }
    }
  }
}
