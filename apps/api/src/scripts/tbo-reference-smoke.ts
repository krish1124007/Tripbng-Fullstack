/**
 * TBO Phase 1 smoke — exercises the reference-data sync pipeline end-to-end:
 *   countries → cities for IN → hotel-code list for one IN city → details
 *   for first 5 hotels.
 *
 * Pre-requisites:
 *   - Phase 0 smoke (tbo-auth-smoke.ts) green.
 *   - Mongo + Redis up.
 *
 * Run:
 *    pnpm --filter @tripbng/api exec tsx src/scripts/tbo-reference-smoke.ts
 *
 * Side effects:
 *   - Writes to tbo_countries, tbo_cities, tbo_hotels.
 *   - Writes audit rows to tbo_audit_logs.
 *
 * Exits 0 if every check passes, 1 otherwise.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectMongo } from '../config/db.js';
import { connectRedis, redis } from '../config/redis.js';
import { TboCity } from '../models/TboCity.js';
import { TboCountry } from '../models/TboCountry.js';
import { TboHotel } from '../models/TboHotel.js';
import {
  syncCitiesForCountry,
  syncCountries,
  syncHotelDetails,
  syncHotelsForCity,
} from '../services/tbo/reference-sync.service.js';

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

  await check('syncCountries', async () => {
    const r = await syncCountries();
    if (r.upserted < 50) throw new Error(`expected ≥ 50 countries, got ${r.upserted}`);
    return `upserted ${r.upserted} (skipped ${r.skipped})`;
  });

  await check('India is among the synced countries', async () => {
    const ind = await TboCountry.findOne({ code: 'IN' }).lean();
    if (!ind) throw new Error('IN not present after syncCountries');
    return `name="${ind.name}"`;
  });

  await check('syncCitiesForCountry(IN)', async () => {
    const r = await syncCitiesForCountry('IN');
    if (r.upserted < 5) throw new Error(`expected ≥ 5 cities, got ${r.upserted}`);
    return `upserted ${r.upserted} (skipped ${r.skipped})`;
  });

  // Pick the first IN city we have to sync hotels for. We don't hardcode
  // a cityId because TBO assigns them — the test should work even if codes
  // change between sandbox refreshes.
  const sampleCity = await TboCity.findOne({ countryCode: 'IN' }).sort({ name: 1 }).lean();
  if (!sampleCity) {
    console.warn('  ! no IN city found, skipping hotel-stage tests');
    process.exit(1);
  }
  console.warn(`  • sample city: ${sampleCity.name} (cityId=${sampleCity.cityId})`);

  await check(`syncHotelsForCity(${sampleCity.cityId})`, async () => {
    const r = await syncHotelsForCity(sampleCity.cityId);
    if (r.upserted < 1) throw new Error(`expected ≥ 1 hotel for ${sampleCity.name}`);
    return `upserted ${r.upserted}`;
  });

  // Pick first 5 hotels for that city to exercise HotelDetails batching.
  const sampleHotels = await TboHotel.find({ cityId: sampleCity.cityId })
    .limit(5)
    .select('hotelCode')
    .lean();
  const codes = sampleHotels.map((h) => h.hotelCode);

  if (codes.length > 0) {
    await check(`syncHotelDetails (${codes.length} codes)`, async () => {
      const r = await syncHotelDetails(codes);
      if (r.upserted < 1) throw new Error('details enrichment returned 0 rows');
      return `upserted ${r.upserted} (fetched ${r.fetched}, skipped ${r.skipped})`;
    });

    await check('detailsSyncedAt populated on enriched hotel', async () => {
      const enriched = await TboHotel.findOne({ hotelCode: codes[0] }).lean();
      if (!enriched?.detailsSyncedAt) {
        throw new Error('detailsSyncedAt is null after syncHotelDetails');
      }
      return `enriched at ${enriched.detailsSyncedAt.toISOString()}`;
    });
  }

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
