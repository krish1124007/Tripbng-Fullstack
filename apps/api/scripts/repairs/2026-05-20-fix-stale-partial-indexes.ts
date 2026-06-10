// Repair: drop+recreate Mongo indexes that were originally created as
// `unique: true, sparse: true` but should be partial-unique on a $type
// check.
//
// Why this matters: Mongoose 8's `sparse` index still INDEXES rows where
// the field exists with value `null` — it only skips when the field is
// absent. Our schemas store `null` as the explicit default (so the
// downstream code can read `doc.idempotencyKey` without an `undefined`
// check), and that means two rows with `idempotencyKey: null` collide
// under a sparse-unique index even though they shouldn't.
//
// The schemas have been migrated to:
//   index({ <field>: 1 }, { unique: true, partialFilterExpression: {
//     <field>: { $type: 'string' } } })
//
// — but Mongoose does NOT auto-drop an existing same-named index when
// the spec changes. Production-cloned databases that were created
// pre-migration still carry the old sparse-unique index and break.
//
// Symptom: booking-hold or wallet-write fails with E11000 on
// `idempotencyKey` (or `pgReferenceId`) with `keyValue: { <field>: null }`.
// With the Phase-17 error-handler fix this surfaces as
// `{code: 'DUPLICATE_KEY', details: {field: 'idempotencyKey'}}` — that's
// the prompt to run this script.
//
// What this script does:
//   For each (collection, field) pair below, drop the existing
//   `<field>_1` index and recreate it with the correct partialFilter.
//   Idempotent: safe to re-run; if the index is already correct it's a
//   no-op (well, a drop+recreate at the same spec — costs an index
//   rebuild but no data lost).
//
// Usage (from apps/api):
//   pnpm exec tsx scripts/repairs/2026-05-20-fix-stale-partial-indexes.ts
//   pnpm exec tsx scripts/repairs/2026-05-20-fix-stale-partial-indexes.ts --apply
//
// Against a non-default DB:
//   MONGO_URI="mongodb+srv://..." pnpm exec tsx \
//     scripts/repairs/2026-05-20-fix-stale-partial-indexes.ts --apply

import mongoose from 'mongoose';
import { env } from '../../src/config/env.js';
import { logger } from '../../src/config/logger.js';

const APPLY = process.argv.includes('--apply');

interface IndexSpec {
  collection: string;
  field: string;
  /** Mongo $type check that the partial filter uses. Almost always 'string'
   *  in our schema — those are deterministic strings minted by the app. */
  typeCheck: string;
}

const SPECS: IndexSpec[] = [
  { collection: 'bookings', field: 'idempotencyKey', typeCheck: 'string' },
  { collection: 'wallettransactions', field: 'pgReferenceId', typeCheck: 'string' },
  { collection: 'paymenttransactions', field: 'idempotencyKey', typeCheck: 'string' },
];

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info(
    { apply: APPLY, mongoUri: env.MONGO_URI.replace(/:[^@:]+@/, ':***@') },
    `Stale-partial-index repair${APPLY ? ' (APPLY)' : ' (DRY RUN)'}`,
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error('mongoose connection has no db handle');

  for (const spec of SPECS) {
    const idxName = `${spec.field}_1`;
    const coll = db.collection(spec.collection);

    // Read the current state. Missing collection (e.g. brand-new DB) → skip.
    let existing: Array<Record<string, unknown>> = [];
    try {
      existing = await coll.indexes();
    } catch (err) {
      logger.warn(
        { collection: spec.collection, err: (err as Error).message },
        'collection missing, skipping',
      );
      continue;
    }
    const current = existing.find((i) => (i as { name?: string }).name === idxName);

    if (!current) {
      logger.info(
        { collection: spec.collection, field: spec.field },
        'no existing index — will create fresh',
      );
      if (APPLY) {
        await coll.createIndex(
          { [spec.field]: 1 },
          {
            unique: true,
            partialFilterExpression: { [spec.field]: { $type: spec.typeCheck } },
            name: idxName,
          },
        );
      }
      continue;
    }

    const isCorrect =
      (current as { partialFilterExpression?: Record<string, unknown> }).partialFilterExpression !==
        undefined &&
      JSON.stringify(
        (current as { partialFilterExpression: Record<string, unknown> })
          .partialFilterExpression,
      ) === JSON.stringify({ [spec.field]: { $type: spec.typeCheck } });

    if (isCorrect) {
      logger.info(
        { collection: spec.collection, field: spec.field },
        'index already in correct shape — no-op',
      );
      continue;
    }

    logger.warn(
      {
        collection: spec.collection,
        field: spec.field,
        currentShape: {
          unique: (current as { unique?: boolean }).unique,
          sparse: (current as { sparse?: boolean }).sparse,
          partialFilterExpression: (current as { partialFilterExpression?: unknown })
            .partialFilterExpression,
        },
        target: { unique: true, partialFilterExpression: { [spec.field]: { $type: spec.typeCheck } } },
      },
      'index has stale shape — would drop+recreate',
    );

    if (APPLY) {
      await coll.dropIndex(idxName);
      await coll.createIndex(
        { [spec.field]: 1 },
        {
          unique: true,
          partialFilterExpression: { [spec.field]: { $type: spec.typeCheck } },
          name: idxName,
        },
      );
      logger.info(
        { collection: spec.collection, field: spec.field },
        'recreated correctly',
      );
    }
  }

  if (!APPLY) {
    logger.info('Dry run complete. Re-run with --apply to actually drop+recreate.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'repair script failed');
  process.exit(1);
});
