// Deterministic banner selector for the ticket PDF (spec §2.4).
//
// At ticket-generation time, pick at most one ACTIVE Banner whose:
//   - location = TICKET_FOOTER
//   - schedule overlaps now
//   - targeting matches the booking (agencyGroupIds / distributorIds)
//
// Among the candidates, take the highest priority. Ties break via a weighted
// random keyed on bookingId — re-downloading the same booking deterministically
// returns the same banner, even if the admin later adds/edits/removes others.
//
// Once selected, the caller MUST snapshot { bannerId, imageUrl, href, title }
// onto booking.ticketTemplate.bannerSnapshot. From then on, re-renders read
// from the snapshot — never re-query.

import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import { Banner, type BannerDoc } from '../../models/Banner.js';
import type { BookingDoc } from '../../models/Booking.js';

export interface BannerSnapshot {
  bannerId: Types.ObjectId;
  imageUrl: string;
  href: string | null;
  title: string;
}

/**
 * Returns the banner to render on this booking's ticket, or null if none match.
 * Pure-ish: reads from Mongo + uses a stable hash for tie-breaking, but does
 * not write. Caller persists the snapshot.
 */
export async function selectBannerForBooking(booking: BookingDoc): Promise<BannerDoc | null> {
  const now = new Date();
  const agencyGroupIds: Types.ObjectId[] = []; // booking schema doesn't carry agency group ids
  // ↑ when the agency-group context lands on Booking, populate this from
  // booking.agency.groupIds. For now, only PLATFORM-targeted banners (empty
  // agencyGroupIds on the banner) match agency-context-less bookings.

  const candidates = await Banner.find({
    tenantId: booking.tenantId,
    location: 'TICKET_FOOTER',
    active: true,
    $and: [
      // schedule windows: missing fields = always-on for that side
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      // agency-group targeting: empty array = all agencies match
      {
        $or: [
          { agencyGroupIds: { $size: 0 } },
          ...(agencyGroupIds.length > 0 ? [{ agencyGroupIds: { $in: agencyGroupIds } }] : []),
        ],
      },
      // distributor targeting: empty array = all distributors match
      {
        $or: [
          { distributorIds: { $size: 0 } },
          ...(booking.distributorId ? [{ distributorIds: booking.distributorId }] : []),
        ],
      },
    ],
  })
    .sort({ priority: -1 })
    .lean();

  if (candidates.length === 0) return null;

  const top = candidates[0]!.priority ?? 0;
  const tied = candidates.filter((c) => (c.priority ?? 0) === top);
  const picked =
    tied.length === 1 ? tied[0]! : weightedPickByBookingId(tied, booking._id.toString());

  // Hydrate to a doc so the caller can read all fields uniformly.
  return Banner.findById(picked._id);
}

/** Convert the booking id into a stable [0,1) float so the choice is
 *  reproducible across re-downloads. SHA-1's first 32 bits are plenty. */
function bookingSeed(bookingId: string): number {
  const hash = crypto.createHash('sha1').update(bookingId).digest();
  const u32 = hash.readUInt32BE(0);
  return u32 / 0xffffffff;
}

/** Weighted random pick — banners with no `weight` field default to 1. */
function weightedPickByBookingId<T extends { _id: unknown }>(items: T[], bookingId: string): T {
  const weights = items.map(() => 1); // current Banner schema has no `weight` field
  const total = weights.reduce((a, b) => a + b, 0);
  const target = bookingSeed(bookingId) * total;
  let cum = 0;
  for (let i = 0; i < items.length; i++) {
    cum += weights[i]!;
    if (target < cum) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** Build the snapshot payload from a chosen banner doc. */
export function bannerSnapshotFromDoc(b: BannerDoc): BannerSnapshot {
  return {
    bannerId: b._id,
    imageUrl: b.imageUrl ?? '',
    href: b.href ?? null,
    title: b.title,
  };
}
