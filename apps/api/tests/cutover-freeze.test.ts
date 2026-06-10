// Tests for the cutover-freeze middleware (Phase 9, runbook §2.1).
//
// Strategy: drive the middleware directly with mock req/res/next. The actual
// Express routing doesn't add coverage value over a unit call — and avoids
// needing to stand up the full app.

import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { redis } from '../src/config/redis.js';
import {
  CUTOVER_FREEZE_KEY,
  readFreezeState,
  requireNotFrozen,
} from '../src/middleware/cutover-freeze.js';

interface MockResponse {
  statusCode: number | null;
  jsonBody: unknown;
  headers: Record<string, string>;
}

function makeRes(): { res: Response; capture: MockResponse } {
  const capture: MockResponse = { statusCode: null, jsonBody: null, headers: {} };
  const res = {
    status(code: number) {
      capture.statusCode = code;
      return this;
    },
    json(body: unknown) {
      capture.jsonBody = body;
      return this;
    },
    setHeader(name: string, value: string) {
      capture.headers[name] = value;
    },
  } as unknown as Response;
  return { res, capture };
}

function makeReq(): Request {
  return {
    path: '/test',
    method: 'POST',
    auth: { agencyId: 'agency-1' },
  } as unknown as Request;
}

beforeAll(async () => {
  await redis.connect().catch(() => undefined); // idempotent — may already be connected
});

afterAll(async () => {
  await redis.del(CUTOVER_FREEZE_KEY).catch(() => undefined);
});

afterEach(async () => {
  // Always release the freeze between tests so a failed test doesn't poison
  // sibling cases.
  await redis.del(CUTOVER_FREEZE_KEY).catch(() => undefined);
  vi.restoreAllMocks();
});

describe('readFreezeState', () => {
  it('reports unfrozen when the key is missing', async () => {
    const state = await readFreezeState();
    expect(state).toEqual({ frozen: false, reason: null, ttlSec: null });
  });

  it('reports frozen + reason + TTL when the key is set with an expiry', async () => {
    await redis.set(CUTOVER_FREEZE_KEY, 'cutover-in-progress', 'EX', 600);
    const state = await readFreezeState();
    expect(state.frozen).toBe(true);
    expect(state.reason).toBe('cutover-in-progress');
    expect(state.ttlSec).toBeGreaterThan(0);
    expect(state.ttlSec).toBeLessThanOrEqual(600);
  });

  it('reports frozen + reason + null TTL when the key has no expiry', async () => {
    await redis.set(CUTOVER_FREEZE_KEY, 'manual-hold');
    const state = await readFreezeState();
    expect(state.frozen).toBe(true);
    expect(state.reason).toBe('manual-hold');
    // ttl returns -1 for no-expiry keys; our wrapper normalises that to null.
    expect(state.ttlSec).toBeNull();
  });

  it('falls back to OPEN when Redis throws', async () => {
    vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('connection lost'));
    const state = await readFreezeState();
    expect(state).toEqual({ frozen: false, reason: null, ttlSec: null });
  });
});

describe('requireNotFrozen middleware', () => {
  it('calls next() when not frozen', async () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();
    const mw = requireNotFrozen('booking');

    await mw(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 503 + JSON envelope when frozen, does NOT call next', async () => {
    await redis.set(CUTOVER_FREEZE_KEY, 'maintenance', 'EX', 300);
    const req = makeReq();
    const { res, capture } = makeRes();
    const next = vi.fn();
    const mw = requireNotFrozen('topup');

    await mw(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(503);
    expect(capture.headers['Retry-After']).toMatch(/^\d+$/);
    expect(capture.jsonBody).toMatchObject({
      success: false,
      error: {
        code: 'CUTOVER_FREEZE',
        reason: 'maintenance',
      },
    });
  });

  it('uses a 60s floor for Retry-After when the key has no TTL', async () => {
    await redis.set(CUTOVER_FREEZE_KEY, 'indefinite');
    const req = makeReq();
    const { res, capture } = makeRes();
    const next = vi.fn();
    const mw = requireNotFrozen('booking');

    await mw(req, res, next as NextFunction);

    expect(capture.statusCode).toBe(503);
    expect(capture.headers['Retry-After']).toBe('60');
  });

  it('fails open on Redis error and calls next', async () => {
    vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('redis down'));
    const req = makeReq();
    const { res, capture } = makeRes();
    const next = vi.fn();
    const mw = requireNotFrozen('booking');

    await mw(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(capture.statusCode).toBeNull(); // never wrote a response
  });

  it('produces identical 503 shape regardless of area label', async () => {
    await redis.set(CUTOVER_FREEZE_KEY, 'rollback', 'EX', 300);
    const captures: MockResponse[] = [];
    for (const area of ['booking', 'topup', 'transfer'] as const) {
      const { res, capture } = makeRes();
      await requireNotFrozen(area)(makeReq(), res, vi.fn() as NextFunction);
      captures.push(capture);
    }
    expect(captures.every((c) => c.statusCode === 503)).toBe(true);
    expect(captures.every((c) => (c.jsonBody as { error: { code: string } }).error.code === 'CUTOVER_FREEZE')).toBe(true);
  });
});
