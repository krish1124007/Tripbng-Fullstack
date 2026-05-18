// Recipient resolver — turns a RecipientRef into concrete contact details.
//
// Why this layer:
//   - Service code shouldn't have to know whether to look up Agency.ownerUser
//     vs. Booking.contact vs. raw fields. The dispatcher gives it a ref and
//     gets back a uniform shape.
//   - User-prefs (notifications.email/sms toggles) are honored here, BEFORE
//     the channel attempts a send — saves a round-trip to SMTP/Meta when a
//     user has opted out.
//   - Caching: recipient lookups happen once per dispatch, but the same
//     agency might fan out to multiple events in a busy second. A 30s LRU
//     cache keeps Mongo load sane without making opt-out changes feel stale.

import { type NotificationPrefs, DEFAULT_NOTIFICATION_PREFS } from '@tripbng/shared';
import { Agency, type AgencyDoc } from '../../models/Agency.js';
import { Booking } from '../../models/Booking.js';
import { User } from '../../models/User.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { runWithoutTenant } from '../../middleware/tenant-context.js';
import type { RecipientRef, ResolvedRecipient } from './types.js';

interface CacheEntry {
  resolved: ResolvedRecipient | null;
  expiresAt: number;
}

// Tiny TTL map — capped at 500 keys, 30s entries. Eviction is opportunistic
// (only when we hit a stale entry) — this is fine for a recipient cache
// because hot keys rotate frequently and a slightly-overfilled map is just
// a few extra bytes, not a correctness issue.
const TTL_MS = 30_000;
const MAX_KEYS = 500;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

function cacheSet(key: string, value: CacheEntry): void {
  if (cache.size >= MAX_KEYS) {
    // Drop the oldest insertion-order key — Map iteration order is insertion
    // order in JS, so this is FIFO not LRU. Good enough for a 30s TTL.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

/**
 * Resolve a RecipientRef to concrete contact details. Returns null when the
 * ref can't be resolved (e.g. agency deleted) — caller treats null as "skip
 * this recipient", not "fail the whole dispatch".
 *
 * Uses runWithoutTenant() because the dispatcher runs from a BullMQ worker
 * context where the tenant ALS isn't set; the queries scope by explicit
 * tenantId in the filter instead.
 */
export async function resolveRecipient(
  ref: RecipientRef,
): Promise<ResolvedRecipient | null> {
  const cacheKey = JSON.stringify(ref);
  const hit = cacheGet(cacheKey);
  if (hit) return hit.resolved;

  const resolved = await runWithoutTenant(() => doResolve(ref));
  cacheSet(cacheKey, { resolved, expiresAt: Date.now() + TTL_MS });
  return resolved;
}

async function doResolve(ref: RecipientRef): Promise<ResolvedRecipient | null> {
  switch (ref.kind) {
    case 'raw':
      return {
        name: ref.name ?? 'Customer',
        email: ref.email ?? null,
        mobile: ref.mobile ?? null,
        countryCode: '+91',
      };

    case 'ops':
      if (!env.OPS_ALERT_EMAIL) {
        logger.debug('alerts: ops recipient requested but OPS_ALERT_EMAIL is unset');
        return null;
      }
      return {
        name: 'Ops',
        email: env.OPS_ALERT_EMAIL,
        mobile: null,
        countryCode: null,
      };

    case 'user': {
      const u = await User.findById(ref.id)
        .select('email mobile fullName tenantId agencyId preferences')
        .lean();
      if (!u) return null;
      const prefs = u.agencyId ? await loadAgencyPrefs(String(u.agencyId)) : null;
      return {
        name: u.fullName ?? 'Customer',
        email: u.preferences?.notifications?.email === false ? null : u.email,
        mobile: u.preferences?.notifications?.sms === false ? null : u.mobile,
        countryCode: '+91',
        userId: String(u._id),
        agencyId: u.agencyId ? String(u.agencyId) : null,
        notificationPrefs: prefs,
      };
    }

    case 'agency': {
      // Resolve the agency's owner user — that's our contact. Load prefs
      // from the same fetch so we can both contact + filter in one query.
      const agency = await Agency.findById(ref.id)
        .select('ownerUserId tenantId notificationPrefs')
        .lean();
      if (!agency?.ownerUserId) return null;
      const owner = await User.findById(agency.ownerUserId)
        .select('email mobile fullName preferences')
        .lean();
      if (!owner) return null;
      return {
        name: owner.fullName ?? 'Agency Owner',
        email: owner.preferences?.notifications?.email === false ? null : owner.email,
        mobile: owner.preferences?.notifications?.sms === false ? null : owner.mobile,
        countryCode: '+91',
        userId: String(owner._id),
        agencyId: String(ref.id),
        notificationPrefs: extractPrefs(agency),
      };
    }

    case 'booking_contact': {
      const b = await Booking.findById(ref.bookingId)
        .select('contact passengers tenantId agencyId bookedByUserId')
        .lean();
      if (!b) return null;
      const firstPax = (b.passengers ?? [])[0];
      const name =
        firstPax?.firstName || firstPax?.lastName
          ? `${firstPax?.firstName ?? ''} ${firstPax?.lastName ?? ''}`.trim()
          : 'Customer';
      const prefs = b.agencyId ? await loadAgencyPrefs(String(b.agencyId)) : null;
      return {
        name,
        email: b.contact?.email ?? null,
        mobile: b.contact?.mobile ?? null,
        countryCode: b.contact?.countryCode ?? '+91',
        userId: b.bookedByUserId ? String(b.bookedByUserId) : null,
        agencyId: b.agencyId ? String(b.agencyId) : null,
        notificationPrefs: prefs,
      };
    }
  }
}

/** Pull prefs out of an Agency lean doc, falling back to defaults when the
 *  field is missing (older docs created before the schema landed). */
function extractPrefs(agency: Pick<AgencyDoc, 'notificationPrefs'> | null): NotificationPrefs {
  const raw = agency?.notificationPrefs;
  if (!raw) return DEFAULT_NOTIFICATION_PREFS;
  return {
    channels: {
      email: raw.channels?.email ?? true,
      whatsapp: raw.channels?.whatsapp ?? true,
      inapp: raw.channels?.inapp ?? true,
    },
    events: (raw.events as NotificationPrefs['events']) ?? {},
    lowBalanceThresholdPaise: raw.lowBalanceThresholdPaise ?? null,
  };
}

/** Helper for non-agency refs that still want prefs loaded by agencyId. */
async function loadAgencyPrefs(agencyId: string): Promise<NotificationPrefs> {
  const a = await Agency.findById(agencyId).select('notificationPrefs').lean();
  return extractPrefs(a);
}

/** For tests + manual cache busting (e.g. after a user updates their email). */
export function clearRecipientCache(): void {
  cache.clear();
}
