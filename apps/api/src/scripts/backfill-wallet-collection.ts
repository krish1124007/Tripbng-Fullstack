// One-time backfill: create a `Wallet` document for every existing Agency and
// Distributor that doesn't have one yet. Run once before deploying Phase-1
// step 6 (the ledger.ts migration that makes `Wallet.balance` the source of
// truth). Idempotent — re-running is safe.
//
// What it does, per legacy owner row:
//   1. Skip if a Wallet doc already exists for this agencyId/distributorId.
//   2. Otherwise create one with:
//        balance        = walletBalance (the legacy cache projection)
//        version        = 0
//        walletCode     = deterministic `AUTO-<KIND>-<ownerId>` (same shape
//                         used by ledger.ts's lazy-create fallback, so a
//                         later run won't double-create).
//
// Why a separate script vs. inline migration: lazy-create-on-first-ledger-call
// works for live agencies but doesn't cover the dormant ones that haven't seen
// activity recently — and we want the integrity cron to find a Wallet doc for
// every agency so dual-write drift detection is meaningful for every row.
//
// Usage:
//   pnpm --filter @tripbng/api exec tsx src/scripts/backfill-wallet-collection.ts
//
// Add `--dry-run` to print the plan without writing.

import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../config/db.js';
import { Agency } from '../models/Agency.js';
import { Distributor } from '../models/Distributor.js';
import { Wallet } from '../models/Wallet.js';
import { logger } from '../config/logger.js';

const DRY_RUN = process.argv.includes('--dry-run');

interface OwnerRow {
  _id: unknown;
  tenantId: unknown;
  walletBalance?: number;
}

async function backfillKind(
  kind: 'AGENCY' | 'DISTRIBUTOR',
): Promise<{ scanned: number; created: number; skipped: number }> {
  const ownerField = kind === 'AGENCY' ? 'agencyId' : 'distributorId';

  // Two near-identical branches, kept separate so TS can resolve the model's
  // overloaded `.find()` signature without union-narrowing failures.
  const owners: OwnerRow[] =
    kind === 'AGENCY'
      ? ((await Agency.find({}).select({ _id: 1, tenantId: 1, walletBalance: 1 }).lean()) as OwnerRow[])
      : ((await Distributor.find({})
          .select({ _id: 1, tenantId: 1, walletBalance: 1 })
          .lean()) as OwnerRow[]);

  if (owners.length === 0) {
    return { scanned: 0, created: 0, skipped: 0 };
  }

  // One round-trip to check who already has a wallet.
  const existingWallets = await Wallet.find({
    [ownerField]: { $in: owners.map((o) => o._id) },
  })
    .select({ _id: 1, [ownerField]: 1 })
    .lean();
  const haveWalletFor = new Set(
    existingWallets.map((w) => String((w as Record<string, unknown>)[ownerField])),
  );

  let created = 0;
  let skipped = 0;
  const toCreate: Array<Record<string, unknown>> = [];

  for (const o of owners) {
    if (haveWalletFor.has(String(o._id))) {
      skipped++;
      continue;
    }
    toCreate.push({
      tenantId: o.tenantId,
      [ownerField]: o._id,
      walletCode: `AUTO-${kind}-${String(o._id)}`,
      balance: o.walletBalance ?? 0,
      version: 0,
    });
  }

  if (DRY_RUN) {
    logger.info(
      { kind, scanned: owners.length, wouldCreate: toCreate.length, skipped },
      'backfill-wallet: dry-run plan',
    );
    return { scanned: owners.length, created: toCreate.length, skipped };
  }

  if (toCreate.length > 0) {
    // `ordered: false` lets the batch continue past any individual collisions
    // (e.g. a previous interrupted backfill already created some rows). Each
    // collision becomes a logged warning, not a script failure.
    try {
      const result = await Wallet.insertMany(toCreate, { ordered: false });
      created = result.length;
    } catch (err) {
      const e = err as { writeErrors?: Array<{ err: { code: number; errmsg: string } }> };
      if (e.writeErrors) {
        const dupes = e.writeErrors.filter((w) => w.err.code === 11000).length;
        const others = e.writeErrors.length - dupes;
        created = toCreate.length - e.writeErrors.length;
        skipped += dupes;
        if (others > 0) {
          logger.error({ kind, others }, 'backfill-wallet: non-duplicate write errors');
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  return { scanned: owners.length, created, skipped };
}

async function main(): Promise<void> {
  await connectMongo();
  const startedAt = Date.now();

  logger.info({ dryRun: DRY_RUN }, 'backfill-wallet: starting');
  const [agencyResult, distResult] = await Promise.all([
    backfillKind('AGENCY'),
    backfillKind('DISTRIBUTOR'),
  ]);

  logger.info(
    {
      durationMs: Date.now() - startedAt,
      agency: agencyResult,
      distributor: distResult,
    },
    'backfill-wallet: done',
  );

  await disconnectMongo();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'backfill-wallet: failed');
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
