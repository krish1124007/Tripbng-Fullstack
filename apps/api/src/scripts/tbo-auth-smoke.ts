/**
 * TBO Phase 0 smoke — exercises the auth service against the real TBO
 * sandbox (Authenticate → Logout). Verifies env wiring, host routing, audit
 * log persistence, and Redis caching end to end.
 *
 * Pre-requisites:
 *   - TBO_ENABLED=true in env
 *   - TBO_USERNAME / TBO_PASSWORD / TBO_END_USER_IP set
 *   - Public IP whitelisted with TBO support
 *   - Mongo + Redis up (for audit log + token cache)
 *
 * Run:
 *    pnpm --filter @tripbng/api exec tsx src/scripts/tbo-auth-smoke.ts
 *
 * Exits 0 if every check passes, 1 if any fails.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectMongo } from '../config/db.js';
import { connectRedis, redis } from '../config/redis.js';
import { tboAuthService } from '../services/tbo/auth.service.js';
import { TboAuditLog } from '../models/TboAuditLog.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.warn(`  ✓ ${name}: ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.warn(`  ✗ ${name}: ${detail}`);
  }
}

async function main() {
  if (!env.TBO_ENABLED) {
    console.warn('TBO_ENABLED is false — set it to "true" and provide TBO_USERNAME/TBO_PASSWORD/TBO_END_USER_IP');
    process.exit(1);
  }
  await connectMongo();
  await connectRedis();

  // Clear cache so we exercise the full Authenticate path.
  await redis.del(env.TBO_TOKEN_CACHE_KEY);

  let token = '';

  await check('Authenticate (cold)', async () => {
    const t = await tboAuthService.getToken();
    if (!t || t.length < 8) throw new Error(`expected non-empty token, got ${JSON.stringify(t)}`);
    token = t;
    return `token (len=${t.length}) cached`;
  });

  await check('Authenticate (warm)', async () => {
    const t = await tboAuthService.getToken();
    if (t !== token) throw new Error('warm read returned different token — cache miss?');
    return 'cache hit';
  });

  await check('Audit log row written', async () => {
    const row = await TboAuditLog.findOne({ method: 'Authenticate' }).sort({ createdAt: -1 }).lean();
    if (!row) throw new Error('no Authenticate audit row found');
    if (row.tboStatus !== 1) throw new Error(`unexpected tboStatus=${row.tboStatus}`);
    const reqAny = row.request as { Password?: string };
    if (reqAny?.Password !== '[REDACTED]') {
      throw new Error('password not redacted in audit row');
    }
    return `audit id=${String(row._id)}, durationMs=${row.durationMs}`;
  });

  await check('forceRefresh returns a (possibly new) token', async () => {
    const t = await tboAuthService.forceRefresh();
    if (!t) throw new Error('forceRefresh returned empty');
    return `len=${t.length}`;
  });

  await check('Logout', async () => {
    await tboAuthService.logout(token);
    return 'best-effort logout completed';
  });

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.warn(`\n${passed} passed, ${failed} failed`);

  await mongoose.disconnect();
  redis.disconnect();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
