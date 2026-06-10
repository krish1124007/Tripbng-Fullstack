// Internal-only API authorisation — gates the /internal/* endpoint family
// (booking engine ↔ wallet service, etc.). Spec §4.4 calls for
// "service-to-service JWT auth"; this is a simpler shared-secret first cut
// that we can upgrade to mTLS / signed JWT later without changing call sites.
//
// Configuration
//   Set `INTERNAL_API_KEY` (≥ 32 chars) in env. Callers must include the
//   same value in the `X-Internal-Key` header. When the env is unset, EVERY
//   request to an internal route is rejected — production must explicitly
//   opt in by configuring a key.
//
// Why a constant-time compare
//   Timing attacks against shared secrets are real and cheap; using
//   `crypto.timingSafeEqual` neutralises the obvious header-length leak.

import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { AppError } from '@tripbng/shared';
import { env } from '../config/env.js';

const HEADER_NAME = 'x-internal-key';

export function requireInternalApiKey(req: Request, _res: Response, next: NextFunction): void {
  const configured = env.INTERNAL_API_KEY;
  if (!configured) {
    // Unconfigured = closed. Don't leak existence of the route to scanners
    // — return the same 404-shaped error as a typo on a public path.
    return next(new AppError('NOT_FOUND'));
  }
  const presented = req.header(HEADER_NAME);
  if (!presented) {
    return next(new AppError('TOKEN_INVALID'));
  }
  // Pad to identical length before timingSafeEqual; the function throws on
  // unequal-length buffers, which itself leaks length information. Take a
  // SHA-256 of both first so any input length compares safely.
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return next(new AppError('TOKEN_INVALID'));
  }
  return next();
}
