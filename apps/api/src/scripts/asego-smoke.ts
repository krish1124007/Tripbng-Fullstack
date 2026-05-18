/**
 * Phase 2 smoke test — exercises every cached master endpoint + a live quote
 * against the ASEGO sandbox, using the actual service layer (so it covers
 * client + cache + identity wiring end-to-end).
 *
 * Run:
 *    pnpm --filter @tripbng/api exec tsx src/scripts/asego-smoke.ts
 *
 * Pass criteria printed at the bottom — exit 0 if all green, 1 otherwise.
 */
import 'dotenv/config';
import { connectRedis, redis } from '../config/redis.js';
import {
  invalidateMasterCache,
  listCategories,
  listCurrencies,
  listPlanMaster,
  listReasons,
} from '../services/insurance/master.service.js';
import { fetchQuote } from '../services/insurance/quote.service.js';

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
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail: msg });
    console.warn(`  ✗ ${name}: ${msg}`);
  }
}

async function main() {
  await connectRedis();

  // Start clean — drop master cache so first reads go live.
  console.warn('▶ invalidating master cache');
  const flush = await invalidateMasterCache();
  console.warn(`  flushed ${flush.deleted} keys`);

  console.warn('\n▶ master fetches (cache miss → live)');
  await check('listCurrencies', async () => {
    const list = await listCurrencies();
    if (!Array.isArray(list) || list.length === 0) throw new Error('empty currency list');
    return `${list.length} currencies (e.g. ${list[0]?.code})`;
  });
  await check('listCategories', async () => {
    const list = await listCategories();
    if (!Array.isArray(list) || list.length === 0) throw new Error('empty category list');
    return `${list.length} categories (e.g. ${list[0]?.name})`;
  });
  await check('listPlanMaster', async () => {
    const data = (await listPlanMaster()) as { totalPlans?: number };
    if (!data || typeof data !== 'object') throw new Error('non-object response');
    return `${data.totalPlans ?? 'N'} plans for partner`;
  });

  console.warn('\n▶ master fetches (cache hit — should return instantly)');
  const t0 = Date.now();
  await listCurrencies();
  const t1 = Date.now();
  await check('cache hit speed', async () => {
    if (t1 - t0 > 50) throw new Error(`took ${t1 - t0} ms — cache may not be working`);
    return `${t1 - t0} ms`;
  });

  console.warn('\n▶ live quote (no cache)');
  await check('fetchQuote (Domestic, age 30, 7 days)', async () => {
    // Pull a Domestic category id from the live master response.
    const categories = await listCategories();
    const domestic = categories.find((c) => c.name.toLowerCase().includes('domestic'));
    if (!domestic) throw new Error('no Domestic category in master');
    const quote = await fetchQuote({
      duration: 7,
      age: 30,
      category: domestic.id,
    });
    const summary = JSON.stringify(quote).slice(0, 80);
    return `${summary}…`;
  });

  console.warn('\n▶ /reasons/:type (known broken on staging)');
  await check('listReasons cancellation', async () => {
    try {
      const list = await listReasons('cancellation');
      return `${list.length} reasons`;
    } catch (err) {
      // Expected on current staging — surface the failure but don't fail the
      // overall smoke. Production / fixed-staging will return a real list.
      return `expected staging failure: ${(err as Error).message}`;
    }
  });

  const failed = results.filter((r) => !r.ok);
  console.warn('\n────────────────────────');
  console.warn(`${results.length - failed.length}/${results.length} passed`);

  await redis.quit();

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
