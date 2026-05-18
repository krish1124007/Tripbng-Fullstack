import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError, type Role } from '@tripbng/shared';

export interface AccessTokenPayload {
  sub: string; // userId
  role: Role;
  agencyId: string | null;
  distributorId: string | null;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // refresh token id, hashed copy stored in DB
  type: 'refresh';
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    if (decoded.type !== 'access') throw new AppError('TOKEN_INVALID');
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED');
    if (err instanceof AppError) throw err;
    throw new AppError('TOKEN_INVALID');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') throw new AppError('TOKEN_INVALID');
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED');
    if (err instanceof AppError) throw err;
    throw new AppError('TOKEN_INVALID');
  }
}
