/**
 * Crypto parity test — ASEGO `createPolicy` is the only endpoint that wants
 * an AES-256-CBC + Base64 encrypted body. Before any real policy is issued
 * in a fresh environment, we verify byte-for-byte that:
 *
 *   (1) local encrypt → ASEGO `/encryption/decrypt` returns the original
 *   (2) ASEGO `/encryption/encrypt` → local decrypt returns the original
 *
 * Run:
 *    pnpm --filter @tripbng/api exec tsx src/scripts/asego-crypto-parity.ts
 *
 * Exit code 0 = parity confirmed, safe to issue policies.
 * Exit code 1 = parity broken — DO NOT proceed; check key/IV encoding (UTF-8 vs hex),
 * padding (must be PKCS7 = Node default), and Base64 vs Hex output expectations.
 *
 * Known staging issue (May-2026): both /encryption/encrypt and /encryption/decrypt
 * on dolphin.asego.in:8080 currently respond with 200 empty body (decrypt) and
 * 500 `{code:500,msg:null}` (encrypt). They do not accept any of the obvious
 * payload shapes (`{data}`, `{plainText}`, `{text}`, plain-text body, query
 * string, identity-block-wrapped). When ASEGO restores those helpers, this
 * script will pass cleanly without any code change. Until then, real verification
 * happens implicitly the first time we hit `createPolicy` in Phase 3 — a wrong
 * key/IV produces a clear "decryption failed" error from ASEGO, not a silent
 * mis-issued policy.
 */
import 'dotenv/config';
import { decryptFromAsego, encryptForAsego } from '../adapters/asego/crypto.js';
import { AsegoClient, readAsegoClientConfigFromEnv } from '../adapters/asego/client.js';

const SAMPLE_PLAINTEXT = JSON.stringify({
  hello: 'asego-parity',
  ts: Date.now(),
  // Mix in special chars so we catch any encoding misadventure.
  unicode: '✓ ₹ é ß',
});

/** ASEGO returns the cipher- or plaintext as the raw response body. Our HTTP
 *  client tries to parse it as JSON — if the original was JSON, we get back
 *  an object, otherwise a string. Handle both. */
function extractStringField(body: unknown): string {
  if (typeof body === 'string') return body;
  // If the original plaintext was JSON, the client parsed it back into an
  // object — round-trip through JSON.stringify gives us back the same string.
  if (body !== null && body !== undefined) return JSON.stringify(body);
  return '';
}

async function rawCall(client: AsegoClient, path: string, body: object): Promise<unknown> {
  // Use post<>() but cast through `unknown` so we can inspect ANY shape.
  return client.post<object, unknown>(path, body);
}

/** Per OpenAPI: ExternalEncryptionRequest = { value, key, initVector }. */
function encryptionPayload(value: string) {
  return {
    value,
    key: process.env.ASEGO_SECRET_KEY!,
    initVector: process.env.ASEGO_INIT_VECTOR!,
  };
}

async function main() {
  const cfg = readAsegoClientConfigFromEnv();
  if (!cfg) {
    console.error('ASEGO_BASE_URL / ASEGO_API_PREFIX missing — cannot run parity test');
    process.exit(1);
  }
  const client = new AsegoClient(cfg);

  console.warn('▶ direction 1: local encrypt → asego decrypt');
  const localCipher = encryptForAsego(SAMPLE_PLAINTEXT);
  console.warn('  local ciphertext (base64):', localCipher.slice(0, 60), '…');

  let decryptResp: unknown;
  try {
    // Try a few payload shapes — ASEGO docs aren't crystal clear on the field name.
    decryptResp = await rawCall(client, '/encryption/decrypt', encryptionPayload(localCipher));
  } catch (err) {
    console.error('  ✗ asego /encryption/decrypt failed:', err);
    process.exit(1);
  }
  console.warn('  raw decrypt response:', JSON.stringify(decryptResp));
  const asegoDecrypted = extractStringField(decryptResp);
  console.warn('  extracted plaintext:', JSON.stringify(asegoDecrypted));
  if (asegoDecrypted !== SAMPLE_PLAINTEXT) {
    console.error('  ✗ MISMATCH — local encrypt does not match asego decrypt');
    console.error('    expected:', SAMPLE_PLAINTEXT);
    console.error('    got     :', asegoDecrypted);
    process.exit(1);
  }
  console.warn('  ✓ direction 1 passed');

  console.warn('▶ direction 2: asego encrypt → local decrypt');
  let encryptResp: unknown;
  try {
    encryptResp = await rawCall(client, '/encryption/encrypt', encryptionPayload(SAMPLE_PLAINTEXT));
  } catch (err) {
    console.error('  ✗ asego /encryption/encrypt failed:', err);
    process.exit(1);
  }
  console.warn('  raw encrypt response:', JSON.stringify(encryptResp));
  const asegoCipher = extractStringField(encryptResp);
  console.warn('  extracted ciphertext:', asegoCipher.slice(0, 60), '…');

  let localDecrypted: string;
  try {
    localDecrypted = decryptFromAsego(asegoCipher);
  } catch (err) {
    console.error('  ✗ local decrypt failed:', err);
    process.exit(1);
  }
  console.warn('  local decrypted:', localDecrypted.slice(0, 60), '…');
  if (localDecrypted !== SAMPLE_PLAINTEXT) {
    console.error('  ✗ MISMATCH — asego encrypt does not match local decrypt');
    console.error('    expected:', SAMPLE_PLAINTEXT);
    console.error('    got     :', localDecrypted);
    process.exit(1);
  }
  console.warn('  ✓ direction 2 passed');

  console.warn('\n✅ ASEGO crypto parity verified — safe to issue policies.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
