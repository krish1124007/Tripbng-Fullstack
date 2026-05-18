// Static guard test — CLAUDE.md §0 Law 1 enforcement.
//
// "tripDetails is never cached. Not in Redis, not in memory, not in a
// CDN, not 'for just a second.'"
//
// This test scans the entire bus + seatseller surface for any cache key
// or call site that mentions tripDetails caching. If a future
// contributor adds one, the test fails loudly. The whitelist below
// covers the legitimate mentions (the law's wording in comments + the
// LIVE-only docstring on getTripDetails).

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', 'src');

/**
 * Walk every .ts file under apps/api/src and run the supplied check.
 * Returns absolute paths of files that fail the check.
 */
async function walkTs(dir: string, fileCheck: (path: string, body: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkTs(full, fileCheck)));
      continue;
    }
    if (!e.name.endsWith('.ts')) continue;
    const body = await readFile(full, 'utf-8');
    if (fileCheck(full, body)) out.push(full);
  }
  return out;
}

// ────────── Forbidden cache-key patterns ──────────
// We scan for two shapes:
//   1. Cache-key string LITERALS that mention tripDetails:
//        "tripDetails:..."   "tripdetails:..."
//   2. redis.set(...) calls where the key arg includes tripDetails

const FORBIDDEN_KEY_PATTERNS = [
  /['"`]\s*tripDetails\s*[:`'"]/i,
  /['"`]\s*tripdetailsv2\s*[:`'"]/i,
  /['"`]bus:tripDetails/i,
  /['"`]bus:tripdetails/i,
];

// Files where mentions of "tripDetails" are intentional (this guard
// itself, the comment-laden cache.service.ts that calls out the law,
// and the trip.service.ts which IMPLEMENTS the LIVE-only call).
const ALLOWED_FILES = new Set<string>([
  'tests/bus-no-trip-details-cache.test.ts', // this file
]);

describe('CLAUDE.md §0 Law 1 — tripDetails is NEVER cached', () => {
  it('no source file declares a cache key naming tripDetails', async () => {
    const offenders = await walkTs(ROOT, (path, body) => {
      const rel = relative(join(__dirname, '..'), path);
      if (ALLOWED_FILES.has(rel)) return false;
      // Strip block comments + line comments before scanning. Comments
      // legitimately mention "tripDetails" (e.g. cache.service.ts
      // explains the law). We only want to catch real code patterns.
      const codeOnly = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const pattern of FORBIDDEN_KEY_PATTERNS) {
        if (pattern.test(codeOnly)) {
          return true;
        }
      }
      return false;
    });
    expect(offenders).toEqual([]);
  });

  it('no source file calls redis.set/setex with a tripDetails key', async () => {
    // Pattern: redis.set( ... 'tripDetails... or `tripDetails... or
    // a variable that shadows it. This is a heuristic — too narrow
    // misses real bugs, too broad creates false positives. We aim for
    // catching the obvious copy-paste; the cache-key registry test
    // above is the structural guard.
    const REDIS_SET_TRIPDETAILS = /redis\.(?:set|setex|psetex)\s*\([^)]*tripdetails/i;
    const offenders = await walkTs(ROOT, (path, body) => {
      const rel = relative(join(__dirname, '..'), path);
      if (ALLOWED_FILES.has(rel)) return false;
      const codeOnly = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return REDIS_SET_TRIPDETAILS.test(codeOnly);
    });
    expect(offenders).toEqual([]);
  });

  it('cache.service exports the explicit no-trip-details guard sentinel', async () => {
    const cacheModule = await import('../src/services/bus/cache.service.js');
    expect(cacheModule.__NO_TRIP_DETAILS_CACHE__).toBeDefined();
    expect(cacheModule.__NO_TRIP_DETAILS_CACHE__.reason).toMatch(/never cached/i);
  });

  it('trip.service.getTripDetails calls the SeatSeller client directly (no cache layer)', async () => {
    // Read the trip.service source and assert getTripDetails does NOT
    // call any of the bus cache helpers. It's allowed to call the BPDP
    // helper for the OTHER endpoint, but the LIVE getTripDetails must
    // pass through to the adapter.
    const path = join(ROOT, 'services', 'bus', 'trip.service.ts');
    const body = await readFile(path, 'utf-8');
    // Scope: between "export async function getTripDetails(" and the
    // function close (next "export " at column 0).
    const start = body.indexOf('export async function getTripDetails(');
    expect(start).toBeGreaterThan(0);
    const after = body.slice(start);
    const nextExportIdx = after.indexOf('\nexport ', 1);
    const fnBody = nextExportIdx === -1 ? after : after.slice(0, nextExportIdx);
    expect(fnBody.toLowerCase()).not.toContain('getcachedtrips');
    expect(fnBody.toLowerCase()).not.toContain('setcachedtrips');
    expect(fnBody.toLowerCase()).not.toContain('redis.get');
    expect(fnBody.toLowerCase()).not.toContain('redis.set');
  });
});
