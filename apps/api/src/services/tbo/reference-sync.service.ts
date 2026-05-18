// TBO reference-data sync orchestration.
//
// Four pipelines:
//   syncCountries()                 — full refresh of tbo_countries (~250 rows)
//   syncCitiesForCountry(code)      — full refresh of cities for a country
//   syncHotelsForCity(cityId)       — lightweight hotel-code list for a city
//   syncHotelDetails(codes[])       — heavy enrichment, batched
//
// Idempotency: every pipeline upserts on the natural key (code / cityId /
// hotelCode). Re-running them is safe — no duplicates, no drift.
//
// Concurrency: HotelDetails is the only batchable call. We chunk into
// HOTEL_DETAILS_BATCH_SIZE codes per request and fan out with
// HOTEL_DETAILS_PARALLEL workers via a tiny p-limit-style helper.

import { logger } from '../../config/logger.js';
import {
  normalizeStringList,
  toNumberOrNull,
  trimOrNull,
  unwrapList,
} from '../../adapters/tbo/parsers.js';
import type {
  TboCityItem,
  TboCityListResponse,
  TboCountryItem,
  TboCountryListResponse,
  TboHotelCodeItem,
  TboHotelCodeListResponse,
  TboHotelDetailsItem,
  TboHotelDetailsResponse,
} from '../../adapters/tbo/types/reference.js';
import { TboCity } from '../../models/TboCity.js';
import { TboCountry } from '../../models/TboCountry.js';
import { TboHotel } from '../../models/TboHotel.js';
import { tboCall } from './client.js';

export interface SyncCountResult {
  fetched: number;
  upserted: number;
  skipped: number;
}

const HOTEL_DETAILS_BATCH_SIZE = 50;
const HOTEL_DETAILS_PARALLEL = 3;

/**
 * Pull every country TBO knows about and upsert into tbo_countries.
 * Idempotent — safe to call repeatedly; only `syncedAt` and `name` may change.
 */
export async function syncCountries(): Promise<SyncCountResult> {
  const res = await tboCall<TboCountryListResponse>({
    method: 'CountryList',
    host: 'shared',
    path: '/CountryList',
    body: {},
  });

  const items = unwrapList<TboCountryItem>(res as unknown as Record<string, unknown>, [
    'CountryList',
    'CountryList.Country',
    'CountryList.CountryCode',
    'Countries',
  ]);

  let upserted = 0;
  let skipped = 0;
  const now = new Date();
  for (const item of items) {
    const code = trimOrNull(item.Code) ?? trimOrNull(item.CountryCode);
    const name = trimOrNull(item.Name) ?? trimOrNull(item.CountryName);
    if (!code || !name) {
      skipped++;
      continue;
    }
    await TboCountry.updateOne(
      { code: code.toUpperCase() },
      { $set: { code: code.toUpperCase(), name, syncedAt: now } },
      { upsert: true },
    );
    upserted++;
  }
  logger.info(
    { fetched: items.length, upserted, skipped },
    'tbo: sync countries done',
  );
  return { fetched: items.length, upserted, skipped };
}

/**
 * Refresh cities for a single country. Country code is upper-cased + sent
 * as-is to TBO; we use whatever format TBO returns it in for storage.
 */
export async function syncCitiesForCountry(countryCode: string): Promise<SyncCountResult> {
  // CityList lives on the TBO Holidays Hotel API (host: 'hotel'), NOT
  // SharedData — verified by probing every host/path/auth combination
  // (May 2026). HotelAPI requires HTTP Basic Auth; the tboCall HTTP client
  // injects it from TBO_HOTEL_USERNAME/TBO_HOTEL_PASSWORD (with fallback to
  // TBO_USERNAME/TBO_PASSWORD).
  const cc = countryCode.toUpperCase();
  const res = await tboCall<TboCityListResponse>({
    method: 'CityList',
    host: 'hotel',
    path: '/CityList',
    body: { CountryCode: cc },
  });

  const items = unwrapList<TboCityItem>(res as unknown as Record<string, unknown>, [
    'CityList',
    'CityList.City',
    'Cities',
  ]);

  let upserted = 0;
  let skipped = 0;
  const now = new Date();
  for (const item of items) {
    const cityId = trimOrNull(item.CityId) ?? trimOrNull(item.CityCode) ?? trimOrNull(item.Code);
    const name = trimOrNull(item.Name) ?? trimOrNull(item.CityName);
    if (!cityId || !name) {
      skipped++;
      continue;
    }
    await TboCity.updateOne(
      { cityId },
      {
        $set: {
          cityId,
          countryCode: cc,
          name,
          state: trimOrNull(item.StateProvince) ?? trimOrNull(item.StateName),
          geo: {
            lat: toNumberOrNull(item.Latitude),
            lng: toNumberOrNull(item.Longitude),
          },
          hotelCount: toNumberOrNull(item.HotelCount),
          syncedAt: now,
        },
      },
      { upsert: true },
    );
    upserted++;
  }
  logger.info(
    { country: cc, fetched: items.length, upserted, skipped },
    'tbo: sync cities done',
  );
  return { fetched: items.length, upserted, skipped };
}

/**
 * Lightweight hotel-code sweep for a city. Only stores cityId + hotelCode +
 * any cheap fields TBO returns inline (name, star). HotelDetails enrichment
 * happens separately via syncHotelDetails().
 */
export async function syncHotelsForCity(cityId: string): Promise<SyncCountResult> {
  // TBOHotelCodeList lives on the TBO Holidays Hotel API (host: 'hotel'),
  // not SharedData. Path name is `/TBOHotelCodeList` per the HotelAPI docs.
  const res = await tboCall<TboHotelCodeListResponse>({
    method: 'TBOHotelCodeList',
    host: 'hotel',
    path: '/TBOHotelCodeList',
    body: { CityIds: cityId, IsDetailedResponse: false },
  });

  const items = unwrapList<TboHotelCodeItem>(res as unknown as Record<string, unknown>, [
    'Hotels',
    'HotelList',
    'HotelList.Hotel',
  ]);

  let upserted = 0;
  let skipped = 0;
  const now = new Date();
  for (const item of items) {
    const hotelCode = trimOrNull(item.HotelCode) ?? trimOrNull(item.TBOHotelCode);
    if (!hotelCode) {
      skipped++;
      continue;
    }
    await TboHotel.updateOne(
      { hotelCode },
      {
        $set: {
          hotelCode,
          cityId: trimOrNull(item.CityCode) ?? cityId,
          countryCode: trimOrNull(item.CountryCode) ?? 'IN',
          name: trimOrNull(item.HotelName),
          starRating: toNumberOrNull(item.StarRating ?? item.HotelRating),
          syncedAt: now,
          isActive: true,
        },
      },
      { upsert: true },
    );
    upserted++;
  }
  logger.info(
    { cityId, fetched: items.length, upserted, skipped },
    'tbo: sync hotels for city done',
  );
  return { fetched: items.length, upserted, skipped };
}

/**
 * Heavy enrichment — fetches full HotelDetails for the given codes and
 * writes the curated fields + raw blob to tbo_hotels. Chunks into batches
 * and fans out with bounded concurrency.
 *
 * Designed for two call patterns:
 *   1. Admin manual trigger ("backfill details for city X")
 *   2. Lazy on first hotel-detail-page open in the UI (later phase)
 */
export async function syncHotelDetails(hotelCodes: string[]): Promise<SyncCountResult> {
  const dedup = Array.from(new Set(hotelCodes.filter((c) => c && c.trim().length > 0)));
  if (dedup.length === 0) return { fetched: 0, upserted: 0, skipped: 0 };

  const batches = chunk(dedup, HOTEL_DETAILS_BATCH_SIZE);
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;

  await runWithConcurrency(batches, HOTEL_DETAILS_PARALLEL, async (batch) => {
    // HotelDetails is a TBO Holidays Hotel API endpoint (host: 'hotel'),
    // not SharedData.
    const res = await tboCall<TboHotelDetailsResponse>({
      method: 'HotelDetails',
      host: 'hotel',
      path: '/HotelDetails',
      body: { HotelCodes: batch.join(','), Language: 'EN' },
    });

    const items = unwrapList<TboHotelDetailsItem>(res as unknown as Record<string, unknown>, [
      'HotelDetails',
      'HotelDetails.Hotel',
      'Hotels',
    ]);
    totalFetched += items.length;

    const now = new Date();
    for (const item of items) {
      const hotelCode = trimOrNull(item.HotelCode);
      if (!hotelCode) {
        totalSkipped++;
        continue;
      }
      await TboHotel.updateOne(
        { hotelCode },
        {
          $set: {
            hotelCode,
            name: trimOrNull(item.HotelName),
            starRating: toNumberOrNull(item.StarRating ?? item.HotelRating),
            address: trimOrNull(item.Address),
            pinCode: trimOrNull(item.PinCode),
            geo: {
              lat: toNumberOrNull(item.Latitude),
              lng: toNumberOrNull(item.Longitude),
            },
            phone: trimOrNull(item.PhoneNumber),
            email: trimOrNull(item.Email),
            description: trimOrNull(item.Description) ?? trimOrNull(item.HotelDescription),
            amenities: normalizeStringList(item.HotelFacilities ?? item.HotelAmenities),
            images: normalizeImages(item.Images ?? item.HotelImages),
            hotelPolicy: trimOrNull(item.HotelPolicy),
            checkInTime: trimOrNull(item.CheckInTime),
            checkOutTime: trimOrNull(item.CheckOutTime),
            countryCode: trimOrNull(item.CountryCode) ?? 'IN',
            cityId: trimOrNull(item.CityCode) ?? '',
            rawDetails: item,
            detailsSyncedAt: now,
            syncedAt: now,
          },
        },
        { upsert: true },
      );
      totalUpserted++;
    }
  });

  logger.info(
    {
      requested: dedup.length,
      fetched: totalFetched,
      upserted: totalUpserted,
      skipped: totalSkipped,
    },
    'tbo: sync hotel details done',
  );
  return { fetched: totalFetched, upserted: totalUpserted, skipped: totalSkipped };
}

// ────────── helpers ──────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Tiny p-limit clone — runs `worker` over `items` with at most `limit` in
 *  flight. Errors propagate. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const next = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item !== undefined) await worker(item);
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(next());
  await Promise.all(runners);
}

function normalizeImages(
  raw: unknown,
): Array<{ url: string; caption: string | null }> {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;|]/) : [];
  const out: Array<{ url: string; caption: string | null }> = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const url = item.trim();
      if (url) out.push({ url, caption: null });
    } else if (item && typeof item === 'object') {
      const obj = item as { Url?: unknown; Caption?: unknown };
      const url = trimOrNull(obj.Url);
      if (url) out.push({ url, caption: trimOrNull(obj.Caption) });
    }
  }
  return out;
}
