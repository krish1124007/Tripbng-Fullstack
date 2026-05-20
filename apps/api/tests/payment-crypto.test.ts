// Pure-function tests for the payment crypto helpers. No I/O, no DB, no
// gateway calls — just verifies the math against known-good vectors so the
// real integrations don't surprise us at credential time.

import { describe, expect, it } from 'vitest';
import {
  hmacSha256Hex,
  phonepeWebhookAuth,
  phonepeXVerifyV1,
  safeEqual,
} from '../src/adapters/payment/crypto.js';

describe('phonepeXVerifyV1', () => {
  it('produces base64 payload + ###saltIndex format', () => {
    const out = phonepeXVerifyV1(
      JSON.stringify({ merchantId: 'M1', amount: 100 }),
      '/pg/v1/pay',
      'salt-key',
      '1',
    );
    expect(out.base64Payload).toBeTruthy();
    expect(out.xVerify).toMatch(/^[0-9a-f]{64}###1$/);
  });

  it('changes hash when payload changes', () => {
    const a = phonepeXVerifyV1('{"a":1}', '/pg/v1/pay', 'salt', '1');
    const b = phonepeXVerifyV1('{"a":2}', '/pg/v1/pay', 'salt', '1');
    expect(a.xVerify).not.toBe(b.xVerify);
  });

  it('changes hash when saltKey changes', () => {
    const a = phonepeXVerifyV1('{}', '/p', 'k1', '1');
    const b = phonepeXVerifyV1('{}', '/p', 'k2', '1');
    expect(a.xVerify).not.toBe(b.xVerify);
  });
});

describe('phonepeWebhookAuth', () => {
  it('produces deterministic SHA256 of user:password', () => {
    const a = phonepeWebhookAuth('user', 'pass');
    const b = phonepeWebhookAuth('user', 'pass');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('differs for different credentials', () => {
    expect(phonepeWebhookAuth('u', 'p')).not.toBe(phonepeWebhookAuth('u', 'q'));
  });
});

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false for different strings of same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
  it('returns false for different lengths (does not throw)', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('hmacSha256Hex', () => {
  it('matches the canonical HMAC-SHA256 fixture', () => {
    // RFC 4231 test vector: key='Jefe', msg='what do ya want for nothing?'
    expect(hmacSha256Hex('what do ya want for nothing?', 'Jefe')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});
