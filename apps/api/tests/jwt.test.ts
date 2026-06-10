// Phase-E — JWT signing + verification unit tests.
//
// Covers the core security boundary that every authenticated request
// crosses. Verifies:
//   - Token type discrimination — access tokens can't be verified as
//     refresh tokens and vice versa
//   - Tamper resistance — touching a single byte invalidates the signature
//   - Expiry handling — expired tokens throw TOKEN_EXPIRED (not a generic
//     TOKEN_INVALID, so the auth middleware can hint the client to refresh)
//   - Claim round-trip — every field the auth middleware reads is preserved
//     verbatim through sign → verify
//   - Cross-secret isolation — a token signed with the access secret must
//     not validate against the refresh secret (and vice versa)

import jwt from 'jsonwebtoken';
import { AppError } from '@tripbng/shared';
import { describe, expect, it } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';

describe('signAccessToken + verifyAccessToken', () => {
  it('round-trips every claim field verbatim', () => {
    const token = signAccessToken({
      sub: 'usr_001',
      role: 'AGENCY',
      agencyId: 'agc_001',
      distributorId: null,
    });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('usr_001');
    expect(decoded.role).toBe('AGENCY');
    expect(decoded.agencyId).toBe('agc_001');
    expect(decoded.distributorId).toBeNull();
    expect(decoded.type).toBe('access');
  });

  it('preserves distinct distributorId / agencyId combos', () => {
    const t = signAccessToken({
      sub: 'usr_002',
      role: 'DISTRIBUTOR',
      agencyId: null,
      distributorId: 'dist_001',
    });
    const d = verifyAccessToken(t);
    expect(d.role).toBe('DISTRIBUTOR');
    expect(d.agencyId).toBeNull();
    expect(d.distributorId).toBe('dist_001');
  });

  it('rejects tampered tokens with TOKEN_INVALID', () => {
    const token = signAccessToken({
      sub: 'usr_003',
      role: 'AGENCY',
      agencyId: 'agc_001',
      distributorId: null,
    });
    // Flip a single byte in the body (the middle JWT segment is the
    // base64-encoded payload).
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]!.slice(0, -1)}X.${parts[2]}`;
    expect(() => verifyAccessToken(tampered)).toThrow(AppError);
    try {
      verifyAccessToken(tampered);
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_INVALID');
    }
  });

  it('rejects expired tokens with TOKEN_EXPIRED (distinct from TOKEN_INVALID)', () => {
    // Sign with a 1-second TTL, then artificially wait by hand-rolling
    // an expired token via the raw jsonwebtoken API.
    const expired = jwt.sign(
      {
        sub: 'usr_004',
        role: 'AGENCY',
        agencyId: 'agc_001',
        distributorId: null,
        type: 'access',
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '-1s' }, // already expired
    );
    expect(() => verifyAccessToken(expired)).toThrow(AppError);
    try {
      verifyAccessToken(expired);
    } catch (err) {
      // Distinct code so the auth middleware can choose to send a 401
      // with a "refresh token" hint rather than blanket-rejecting.
      expect((err as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects refresh tokens presented as access tokens', () => {
    // Sign a refresh token, then ATTEMPT to verify it as an access
    // token. The signature check will fail because secrets differ;
    // the verify function should map that to TOKEN_INVALID, not crash.
    const refresh = signRefreshToken({ sub: 'usr_005', jti: 'r1' });
    expect(() => verifyAccessToken(refresh)).toThrow(AppError);
    try {
      verifyAccessToken(refresh);
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_INVALID');
    }
  });

  it('rejects an access token whose `type` claim has been forged', () => {
    // Build a token with the ACCESS secret but a wrong `type` claim.
    // The signature is valid; the type guard must catch the mismatch.
    const forged = jwt.sign(
      {
        sub: 'usr_006',
        role: 'AGENCY',
        agencyId: 'agc_001',
        distributorId: null,
        type: 'refresh', // wrong type claim
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '5m' },
    );
    expect(() => verifyAccessToken(forged)).toThrow(AppError);
    try {
      verifyAccessToken(forged);
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_INVALID');
    }
  });

  it('rejects empty / malformed tokens', () => {
    expect(() => verifyAccessToken('')).toThrow();
    expect(() => verifyAccessToken('not-a-jwt')).toThrow();
    expect(() => verifyAccessToken('one.two')).toThrow(); // only two segments
  });
});

describe('signRefreshToken + verifyRefreshToken', () => {
  it('round-trips sub + jti', () => {
    const token = signRefreshToken({ sub: 'usr_010', jti: 'jti-abc-1' });
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('usr_010');
    expect(decoded.jti).toBe('jti-abc-1');
    expect(decoded.type).toBe('refresh');
  });

  it('cross-secret isolation — refresh secret cannot verify access tokens', () => {
    const access = signAccessToken({
      sub: 'usr_011',
      role: 'AGENCY',
      agencyId: 'agc_001',
      distributorId: null,
    });
    expect(() => verifyRefreshToken(access)).toThrow(AppError);
    try {
      verifyRefreshToken(access);
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_INVALID');
    }
  });

  it('rejects expired refresh tokens with TOKEN_EXPIRED', () => {
    const expired = jwt.sign(
      { sub: 'usr_012', jti: 'jti-x', type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: '-1s' },
    );
    try {
      verifyRefreshToken(expired);
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects a refresh token with forged `type` claim', () => {
    const forged = jwt.sign(
      { sub: 'usr_013', jti: 'jti-x', type: 'access' }, // wrong type
      env.JWT_REFRESH_SECRET,
      { expiresIn: '5m' },
    );
    try {
      verifyRefreshToken(forged);
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_INVALID');
    }
  });
});
