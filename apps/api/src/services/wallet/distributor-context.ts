// Distributor context resolver — unification seam (Phase-16, Conflict 2).
//
// Today's model:
//   - Distributors live in their own collection (`distributors`)
//   - Agencies (`agencies`) can have `module = 'DISTRIBUTOR'` but those rows
//     aren't currently used as the source of truth — distributor-by-id
//     lookups go straight to the Distributor collection
//
// Spec direction (AGENCY_WALLET_GAP_ANALYSIS.md §Conflict 2):
//   Eventually unify so an "agency with module=DISTRIBUTOR" is the
//   canonical distributor representation, and the standalone Distributor
//   collection is either backfilled-and-dropped or kept as a thin
//   join target.
//
// This module is the reader-side seam. Code that needs "given an actor /
// org id, what are the distributor's display fields" goes through here
// instead of doing a raw Distributor.findById. When the migration flips
// the source-of-truth, only the resolution order in this file changes;
// callers stay put.
//
// Resolution order (today):
//   1. Distributor collection lookup
//   2. Agency where module=DISTRIBUTOR and _id=id (covers any rows that
//      already use the unified shape — rare today, will be common later)
//
// When neither resolves: returns null. Caller treats that as "not a
// distributor" — same semantics regardless of which collection
// ultimately holds the data.

import type { Types } from 'mongoose';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';

export interface DistributorContext {
  id: string;
  /** distributorCode (legacy) OR agencyCode (unified) — caller doesn't care which. */
  code: string;
  companyName: string;
  ownerUserId: string;
  status: string;
  /** Which collection answered the lookup. Useful for debugging and the
   *  eventual migration audit; callers should not branch on this. */
  source: 'distributor' | 'agency';
}

/**
 * Resolve one distributor by id. Hits Distributor first (current model),
 * falls back to Agency where module=DISTRIBUTOR (future-unified model).
 * Returns null when neither collection has a match.
 */
export async function resolveDistributorContext(
  id: string | Types.ObjectId,
): Promise<DistributorContext | null> {
  // 1. Distributor collection — today's authoritative source.
  const d = await Distributor.findById(id)
    .select('_id distributorCode companyName ownerUserId status')
    .lean();
  if (d) {
    return {
      id: String(d._id),
      code: d.distributorCode,
      companyName: d.companyName,
      ownerUserId: String(d.ownerUserId),
      status: d.status,
      source: 'distributor',
    };
  }

  // 2. Agency where module=DISTRIBUTOR — future-unified representation.
  const a = await Agency.findOne({ _id: id, module: 'DISTRIBUTOR' })
    .select('_id agencyCode companyName ownerUserId status')
    .lean();
  if (a) {
    return {
      id: String(a._id),
      code: a.agencyCode,
      companyName: a.companyName,
      ownerUserId: String(a.ownerUserId),
      status: a.status,
      source: 'agency',
    };
  }

  return null;
}

/**
 * Batch variant — single Distributor.find + single Agency.find for any
 * misses. Use this whenever rendering a list of distributors (or downline
 * activity feeds, where many distributorIds get serialised together).
 *
 * Returns a Map keyed by string id so callers can join by the same string
 * they're already serialising. Misses are absent from the Map (not present
 * with a null value) — gives the caller a clean has-check.
 */
export async function resolveDistributorContexts(
  ids: ReadonlyArray<string | Types.ObjectId>,
): Promise<Map<string, DistributorContext>> {
  const result = new Map<string, DistributorContext>();
  if (ids.length === 0) return result;

  const distributors = await Distributor.find({ _id: { $in: ids as Types.ObjectId[] } })
    .select('_id distributorCode companyName ownerUserId status')
    .lean();
  for (const d of distributors) {
    result.set(String(d._id), {
      id: String(d._id),
      code: d.distributorCode,
      companyName: d.companyName,
      ownerUserId: String(d.ownerUserId),
      status: d.status,
      source: 'distributor',
    });
  }

  // Anything still missing — try the unified Agency representation.
  const missing = ids.filter((id) => !result.has(String(id))) as Types.ObjectId[];
  if (missing.length > 0) {
    const agencies = await Agency.find({
      _id: { $in: missing },
      module: 'DISTRIBUTOR',
    })
      .select('_id agencyCode companyName ownerUserId status')
      .lean();
    for (const a of agencies) {
      result.set(String(a._id), {
        id: String(a._id),
        code: a.agencyCode,
        companyName: a.companyName,
        ownerUserId: String(a.ownerUserId),
        status: a.status,
        source: 'agency',
      });
    }
  }

  return result;
}

/**
 * Determine whether a given id is a distributor — regardless of which
 * collection holds it. Convenience for guard / permission checks that
 * don't need the full context object.
 */
export async function isDistributor(id: string | Types.ObjectId): Promise<boolean> {
  return (await resolveDistributorContext(id)) !== null;
}
