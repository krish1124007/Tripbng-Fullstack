// Integration tests for the per-agency wallet lock helper.
//
// Uses the real local Redis (vitest.config wires REDIS_URL). Each test uses a
// unique random agencyId so parallel runs and re-runs don't collide on keys.

import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { redis } from '../src/config/redis.js';
import { WalletLockError, withWalletLock } from '../src/utils/wallet-lock.js';

const aid = () => `test-${crypto.randomBytes(6).toString('hex')}`;
const KEY = (id: string) => `wallet:lock:${id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  // Drop any test keys we may have left behind (the helper releases on its own,
  // but explicit cleanup keeps Redis tidy for re-runs).
  const keys = await redis.keys('wallet:lock:test-*');
  if (keys.length) await redis.del(...keys);
});

describe('withWalletLock', () => {
  it('acquires, runs the critical section, and releases the lock', async () => {
    const agencyId = aid();
    let observed: string | null = 'unset';
    const result = await withWalletLock(agencyId, async () => {
      observed = await redis.get(KEY(agencyId));
      return 'done';
    });
    expect(result).toBe('done');
    expect(observed).not.toBeNull();
    // Released after `fn` returns.
    expect(await redis.get(KEY(agencyId))).toBeNull();
  });

  it('releases the lock even when the critical section throws', async () => {
    const agencyId = aid();
    await expect(
      withWalletLock(agencyId, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await redis.get(KEY(agencyId))).toBeNull();
  });

  it('serialises concurrent callers for the same agency', async () => {
    const agencyId = aid();
    const events: string[] = [];
    // Two callers race for the same agency. Each holds the lock for 80ms.
    // Total wall time should be ≥ 160ms (they cannot overlap) but ≤ ~400ms
    // (allowing for backoff jitter on the loser).
    const startedAt = Date.now();
    await Promise.all([
      withWalletLock(agencyId, async () => {
        events.push('A:start');
        await sleep(80);
        events.push('A:end');
      }),
      withWalletLock(agencyId, async () => {
        events.push('B:start');
        await sleep(80);
        events.push('B:end');
      }),
    ]);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    // The interleaving cannot be A:start, B:start, ... because they hold the same lock.
    // Whichever wins, its `:end` must come before the other's `:start`.
    const firstEnd = events.findIndex((e) => e.endsWith(':end'));
    const lastStart = events.length - 1 - [...events].reverse().findIndex((e) => e.endsWith(':start'));
    expect(firstEnd).toBeLessThan(lastStart);
  });

  it('does NOT serialise different agencies', async () => {
    const a = aid();
    const b = aid();
    let aHolding = false;
    let bSawAHolding = false;
    await Promise.all([
      withWalletLock(a, async () => {
        aHolding = true;
        await sleep(50);
        aHolding = false;
      }),
      withWalletLock(b, async () => {
        // Give A a head-start so we can observe its lock from B's critical
        // section. They use different agencyIds so should run concurrently.
        await sleep(10);
        bSawAHolding = aHolding;
      }),
    ]);
    expect(bSawAHolding).toBe(true);
  });

  it('throws LOCK_TIMEOUT if the lock cannot be acquired within budget', async () => {
    const agencyId = aid();
    // Park the lock manually with a long TTL.
    await redis.set(KEY(agencyId), 'foreign-holder', 'PX', 5_000, 'NX');
    const startedAt = Date.now();
    await expect(
      withWalletLock(agencyId, async () => 'should-never-run', { acquireTimeoutMs: 250 }),
    ).rejects.toBeInstanceOf(WalletLockError);
    const elapsed = Date.now() - startedAt;
    // Should give up around the timeout, not much later.
    expect(elapsed).toBeLessThan(700);
    // Foreign lock must still be there — we don't blow it away on timeout.
    expect(await redis.get(KEY(agencyId))).toBe('foreign-holder');
    await redis.del(KEY(agencyId));
  });

  it('LOCK_TIMEOUT error carries the right code + agencyId', async () => {
    const agencyId = aid();
    await redis.set(KEY(agencyId), 'foreign-holder', 'PX', 2_000, 'NX');
    try {
      await withWalletLock(agencyId, async () => 'x', { acquireTimeoutMs: 100 });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WalletLockError);
      expect((err as WalletLockError).code).toBe('LOCK_TIMEOUT');
      expect((err as WalletLockError).agencyId).toBe(agencyId);
    }
    await redis.del(KEY(agencyId));
  });

  it('release is a no-op when the lock was stolen mid-flight (LOCK_LOST)', async () => {
    const agencyId = aid();
    // Use a very short TTL so the lock expires during our critical section.
    // After expiry, a "foreign" caller grabs it. When we then try to release,
    // our compare-and-delete must NOT remove the foreign holder.
    const stolen = withWalletLock(
      agencyId,
      async () => {
        // Let our 100ms TTL expire.
        await sleep(150);
        // Someone else acquires while we're "still working".
        const ok = await redis.set(KEY(agencyId), 'foreign-holder', 'PX', 5_000, 'NX');
        expect(ok).toBe('OK');
        return 'done';
      },
      { ttlMs: 100, acquireTimeoutMs: 500 },
    );
    await stolen;
    // Our release should NOT have removed the foreign holder's lock.
    expect(await redis.get(KEY(agencyId))).toBe('foreign-holder');
    await redis.del(KEY(agencyId));
  });

  it('waits and acquires when contention clears within the budget', async () => {
    const agencyId = aid();
    // Park the lock briefly; our caller's retry loop should pick it up after release.
    await redis.set(KEY(agencyId), 'foreign-holder', 'PX', 200, 'NX');
    const result = await withWalletLock(
      agencyId,
      async () => 'got-it',
      { acquireTimeoutMs: 1_500 },
    );
    expect(result).toBe('got-it');
  });
});
