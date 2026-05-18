// Nightly TBO reference-data sync — fires at 02:00 IST.
//
// Pipeline:
//   1. syncCountries()                          — full refresh.
//   2. for each cc in TBO_REFERENCE_COUNTRIES:  syncCitiesForCountry(cc).
//   3. for each cityId in TBO_REFERENCE_HOTEL_CITIES: syncHotelsForCity().
//
// Hotel detail enrichment is NOT in the nightly path — too heavy. Triggered
// manually via the admin endpoint or lazily by the search/detail flow once
// those phases land.
//
// Why 02:00 IST: TBO's daily token rotates at midnight IST and any heavy
// load on their API just after midnight risks racing the rotation. Two
// hours of headroom is generous.

import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import {
  syncCitiesForCountry,
  syncCountries,
  syncHotelsForCity,
} from '../services/tbo/reference-sync.service.js';
import { getTboReferenceSyncQueue, QUEUE_NAMES } from './index.js';

const SWEEP_JOB_NAME = 'tbo-reference-nightly';
const SWEEP_CRON = '0 2 * * *';
const SWEEP_TZ = 'Asia/Kolkata';

export async function scheduleTboReferenceSync(): Promise<void> {
  if (!env.TBO_ENABLED) {
    logger.info('tbo: integration disabled, skipping reference-sync scheduler');
    return;
  }
  const queue = getTboReferenceSyncQueue();
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.name === SWEEP_JOB_NAME)
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
  await queue.add(
    SWEEP_JOB_NAME,
    {},
    {
      repeat: { pattern: SWEEP_CRON, tz: SWEEP_TZ },
      removeOnComplete: 30,
      removeOnFail: 100,
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.TBO_REFERENCE_SYNC, cron: SWEEP_CRON, tz: SWEEP_TZ },
    'tbo: reference-sync scheduler armed',
  );
}

export async function tboReferenceSyncProcessor(_job: Job): Promise<{
  countries: number;
  citiesByCountry: Record<string, number>;
  hotelsByCity: Record<string, number>;
}> {
  if (!env.TBO_ENABLED) return { countries: 0, citiesByCountry: {}, hotelsByCity: {} };

  // Stage 1: countries (always full refresh).
  const countriesResult = await syncCountries();

  // Stage 2: cities for each tracked country.
  const trackedCountries = parseCsv(env.TBO_REFERENCE_COUNTRIES);
  const citiesByCountry: Record<string, number> = {};
  for (const cc of trackedCountries) {
    try {
      const r = await syncCitiesForCountry(cc);
      citiesByCountry[cc] = r.upserted;
    } catch (err) {
      logger.warn({ err, cc }, 'tbo: city sync failed for country, continuing');
      citiesByCountry[cc] = -1;
    }
  }

  // Stage 3: lightweight hotel-code list for each tracked city. Skipped if
  // the env var is empty (default — too heavy without explicit opt-in).
  const trackedCities = parseCsv(env.TBO_REFERENCE_HOTEL_CITIES);
  const hotelsByCity: Record<string, number> = {};
  for (const cityId of trackedCities) {
    try {
      const r = await syncHotelsForCity(cityId);
      hotelsByCity[cityId] = r.upserted;
    } catch (err) {
      logger.warn({ err, cityId }, 'tbo: hotel sync failed for city, continuing');
      hotelsByCity[cityId] = -1;
    }
  }

  logger.info(
    { countries: countriesResult.upserted, citiesByCountry, hotelsByCity },
    'tbo: nightly reference sweep done',
  );
  return { countries: countriesResult.upserted, citiesByCountry, hotelsByCity };
}

function parseCsv(s: string): string[] {
  return s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
