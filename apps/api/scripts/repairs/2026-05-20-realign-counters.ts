// Repair: realign every Counter to (max-existing-sequence + 1) for its prefix.
//
// Background: every human-readable code in the system (booking refs, wallet
// txn ids, user codes, etc.) is minted by an atomic findOneAndUpdate on the
// `counters` collection (utils/codes.ts → nextCode). The contract is that
// `counter.seq` is always >= the highest sequence number present in the
// owning collection — so the next mint is fresh.
//
// That contract can break under three conditions:
//   1. Data restored from a backup that included the data collections but
//      NOT the counters collection (or vice versa)
//   2. Manual inserts (admin scripts, support tickets) that bypassed nextCode
//   3. A counter row got wiped / reset while the data collections kept their
//      rows
//
// Symptom: a fresh write throws Mongo E11000 on the unique code column —
// e.g. `bookingCode: "TBNG000003"` collides because a row with that exact
// code already exists. With the Phase-17 error-handler fix, the API now
// returns `{code: 'DUPLICATE_KEY', details: {field: 'bookingCode'}}`
// instead of the misleading `EMAIL_TAKEN`.
//
// What this script does:
//   For each (prefix, collection, codeField) pair, find the max numeric
//   suffix of `<prefix><digits>` already in the data collection, then
//   ensure the counter row's `seq` is at least that high. Idempotent.
//
// Safety:
//   - Dry-run by default; --apply writes.
//   - Only ADVANCES counters. Never decreases (that would replay codes).
//   - Per-prefix output so ops can sanity-check.
//
// Usage:
//   pnpm -F @tripbng/api exec tsx scripts/repairs/2026-05-20-realign-counters.ts
//   pnpm -F @tripbng/api exec tsx scripts/repairs/2026-05-20-realign-counters.ts --apply
//
// Against a non-default DB (production):
//   MONGO_URI="mongodb+srv://..." pnpm -F @tripbng/api exec tsx \
//     scripts/repairs/2026-05-20-realign-counters.ts --apply

import mongoose from 'mongoose';
import { env } from '../../src/config/env.js';
import { logger } from '../../src/config/logger.js';
import { Counter } from '../../src/models/Counter.js';
import { Booking } from '../../src/models/Booking.js';
import { WalletTransaction } from '../../src/models/WalletTransaction.js';
import { PaymentTransaction } from '../../src/models/PaymentTransaction.js';
import { User } from '../../src/models/User.js';
import { Agency } from '../../src/models/Agency.js';
import { Distributor } from '../../src/models/Distributor.js';

const APPLY = process.argv.includes('--apply');

interface PrefixSpec {
  prefix: string;
  /** Description shown in logs. */
  label: string;
  /** Async function that returns the highest sequence number already in
   *  the owning collection (e.g. 17 for "TBNG000017"). Returns 0 if empty. */
  maxSeq: () => Promise<number>;
}

/** Pull the numeric tail off a code like "TBNG000123" → 123. */
function tailNum(code: string | null | undefined, prefix: string): number {
  if (!code) return 0;
  if (!code.startsWith(prefix)) return 0;
  const tail = code.slice(prefix.length);
  const n = Number(tail);
  return Number.isFinite(n) ? n : 0;
}

async function maxFromCollection(
  model: mongoose.Model<unknown>,
  field: string,
  prefix: string,
): Promise<number> {
  // Use a $regex anchored on the prefix so we ignore weirdly-formed legacy
  // codes (e.g. ones with a different prefix that slipped into the same
  // collection during a backfill).
  const row = await model
    .findOne({ [field]: { $regex: `^${prefix}\\d+$` } } as Record<string, unknown>)
    .sort({ [field]: -1 } as Record<string, 1 | -1>)
    .select({ [field]: 1, _id: 0 } as Record<string, 0 | 1>)
    .lean<Record<string, string>>();
  return tailNum(row?.[field], prefix);
}

const SPECS: PrefixSpec[] = [
  {
    prefix: 'TBNG',
    label: 'Booking refs',
    maxSeq: () =>
      maxFromCollection(Booking as unknown as mongoose.Model<unknown>, 'bookingCode', 'TBNG'),
  },
  {
    prefix: 'WTX',
    label: 'Wallet transactions',
    maxSeq: () =>
      maxFromCollection(
        WalletTransaction as unknown as mongoose.Model<unknown>,
        'txnId',
        'WTX',
      ),
  },
  {
    prefix: 'PT',
    label: 'Payment transactions',
    maxSeq: async () => {
      // PaymentTransaction.txnCode lives under a per-tenant counter; for the
      // simple realign we just take the highest across all tenants. The
      // counter is keyed by `paytxn-<tenantId>` though — handled below.
      return 0;
    },
  },
  {
    prefix: 'AT',
    label: 'Agency users + Agency codes (shared)',
    maxSeq: async () => {
      const a = await maxFromCollection(
        User as unknown as mongoose.Model<unknown>,
        'userCode',
        'AT',
      );
      const b = await maxFromCollection(
        Agency as unknown as mongoose.Model<unknown>,
        'agencyCode',
        'AT',
      );
      return Math.max(a, b);
    },
  },
  {
    prefix: 'D',
    label: 'Distributor codes',
    maxSeq: async () => {
      const a = await maxFromCollection(
        User as unknown as mongoose.Model<unknown>,
        'userCode',
        'D',
      );
      const b = await maxFromCollection(
        Distributor as unknown as mongoose.Model<unknown>,
        'distributorCode',
        'D',
      );
      return Math.max(a, b);
    },
  },
  {
    prefix: 'SA',
    label: 'Super-admin user codes',
    maxSeq: () =>
      maxFromCollection(User as unknown as mongoose.Model<unknown>, 'userCode', 'SA'),
  },
];

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info(
    { apply: APPLY, mongoUri: env.MONGO_URI.replace(/:[^@:]+@/, ':***@') },
    `Counter realign${APPLY ? ' (APPLY)' : ' (DRY RUN)'}`,
  );

  let movedAny = false;

  for (const spec of SPECS) {
    const counter = await Counter.findOne({ prefix: spec.prefix }).lean();
    const counterSeq = counter?.seq ?? 0;
    const dataMax = await spec.maxSeq();
    const targetSeq = Math.max(counterSeq, dataMax);
    const driftedBehind = dataMax > counterSeq;

    logger.info(
      {
        prefix: spec.prefix,
        label: spec.label,
        counterSeq,
        dataMax,
        driftedBehind,
        action: driftedBehind ? `advance to ${dataMax}` : 'no-op',
      },
      driftedBehind ? 'counter DRIFTED BEHIND data — would advance' : 'counter is healthy',
    );

    if (driftedBehind && APPLY) {
      // upsert so a missing counter doc gets created
      await Counter.updateOne(
        { prefix: spec.prefix },
        { $set: { seq: targetSeq } },
        { upsert: true },
      );
      movedAny = true;
    }
  }

  // Per-tenant payment-transaction counters (paytxn-<tenantId>) get a
  // separate sweep — every tenant with at least one PT has its own row.
  // We use the raw driver because PT counters use `_id` as a STRING
  // ("paytxn-<hex>") which Mongoose's default ObjectId-cast on _id rejects
  // for a $regex query.
  const ptCountersRaw = (await Counter.collection
    .find({ _id: { $regex: '^paytxn-' } as unknown as string })
    .toArray()) as Array<{ _id: string; seq?: number }>;
  for (const c of ptCountersRaw) {
    const tenantId = String(c._id).replace(/^paytxn-/, '');
    const row = await PaymentTransaction.findOne({ tenantId } as Record<string, unknown>)
      .sort({ txnCode: -1 } as Record<string, 1 | -1>)
      .select({ txnCode: 1, _id: 0 } as Record<string, 0 | 1>)
      .lean<{ txnCode?: string }>();
    const dataMax = tailNum(row?.txnCode, 'PT');
    const counterSeq = c.seq ?? 0;
    const driftedBehind = dataMax > counterSeq;
    logger.info(
      { counterId: c._id, tenantId, counterSeq, dataMax, driftedBehind },
      driftedBehind ? 'PT counter DRIFTED BEHIND for tenant' : 'PT counter healthy',
    );
    if (driftedBehind && APPLY) {
      await Counter.collection.updateOne({ _id: c._id as unknown as object }, { $set: { seq: dataMax } });
      movedAny = true;
    }
  }

  if (!APPLY) {
    logger.info('Dry run complete. Re-run with --apply to write.');
  } else if (movedAny) {
    logger.info('Counters advanced.');
  } else {
    logger.info('No counters needed advancing — all healthy.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'realign script failed');
  process.exit(1);
});
