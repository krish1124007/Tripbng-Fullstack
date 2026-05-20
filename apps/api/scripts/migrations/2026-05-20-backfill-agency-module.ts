// Migration: classify every Agency into the right `module` value (Phase 9,
// AGENCY_WALLET_SYSTEM spec §18 step 1).
//
// Existing rows default to `CASH` via the schema. This script walks each
// agency and promotes it based on observable state:
//
//   Classification rules (first match wins, top-down):
//     1. CREDIT      — Agency.creditLimit > 0
//                      (these are the historical credit-line customers)
//     2. DI          — has an active DepositIncentiveConfig with agencyId = this
//                      (per-agency override; the tenant-wide fallback config
//                      doesn't classify the agency into DI by itself, since
//                      that config applies as a default to CASH agencies too)
//     3. SUB_AGENT   — Agency.distributorId != null (parented to a Distributor row)
//     4. CASH        — leftover; matches schema default, no-op write
//
// Distributors themselves live in the `Distributor` collection — they're not
// Agency rows and therefore not touched here. The DISTRIBUTOR module value is
// reserved for an in-flight design where distributors will be unified into
// the Agency collection (CLAUDE.md §8 v2 backlog) and is intentionally not
// assigned by this script.
//
// Safety:
//   - Idempotent: re-running matches the same rows and writes the same values.
//   - Dry-run by default: `--apply` actually writes.
//   - Per-tenant counts logged so ops can sanity-check totals.
//   - Skips rows that already have a non-CASH module value (preserves manual
//     admin overrides that may have happened since cutover).
//
// Usage:
//   pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-backfill-agency-module.ts
//   pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-backfill-agency-module.ts --apply

import mongoose from 'mongoose';
import { env } from '../../src/config/env.js';
import { logger } from '../../src/config/logger.js';
import { Agency } from '../../src/models/Agency.js';
import { DepositIncentiveConfig } from '../../src/models/DepositIncentiveConfig.js';
import type { AgencyModule } from '@tripbng/shared';

interface AgencyRow {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  module: AgencyModule;
  creditLimit: number;
  distributorId: mongoose.Types.ObjectId | null;
}

interface Plan {
  total: number;
  byTargetModule: Record<AgencyModule, number>;
  skippedNonCash: number;
  perTenant: Record<string, { CREDIT: number; DI: number; SUB_AGENT: number; CASH: number }>;
}

async function classify(): Promise<{
  plan: Plan;
  updates: Map<AgencyModule, mongoose.Types.ObjectId[]>;
}> {
  const agencies = (await Agency.find({})
    .select({ _id: 1, tenantId: 1, module: 1, creditLimit: 1, distributorId: 1 })
    .lean()) as unknown as AgencyRow[];

  // One query gets every agency that has an explicit per-agency DI config row.
  // We pull just the agencyId set so the per-agency lookup below is O(1).
  const diConfigRows = await DepositIncentiveConfig.find({
    agencyId: { $ne: null },
    isActive: true,
  })
    .select({ agencyId: 1 })
    .lean();
  const agencyIdsWithDi = new Set(diConfigRows.map((r) => String(r.agencyId)));

  const updates: Map<AgencyModule, mongoose.Types.ObjectId[]> = new Map([
    ['CREDIT', []],
    ['DI', []],
    ['SUB_AGENT', []],
    ['CASH', []],
  ]);

  const plan: Plan = {
    total: agencies.length,
    byTargetModule: { CREDIT: 0, DI: 0, SUB_AGENT: 0, CASH: 0, DISTRIBUTOR: 0 },
    skippedNonCash: 0,
    perTenant: {},
  };

  for (const a of agencies) {
    // Preserve any non-CASH value already set — that's an explicit admin
    // override since the last run, and we don't want to clobber it.
    if (a.module && a.module !== 'CASH') {
      plan.skippedNonCash++;
      continue;
    }

    let target: AgencyModule;
    if (a.creditLimit > 0) {
      target = 'CREDIT';
    } else if (agencyIdsWithDi.has(String(a._id))) {
      target = 'DI';
    } else if (a.distributorId) {
      target = 'SUB_AGENT';
    } else {
      target = 'CASH';
    }

    // No-op for CASH — schema default already gave us this value; writing
    // would just churn `updatedAt`.
    if (target === 'CASH') {
      plan.byTargetModule.CASH++;
      continue;
    }

    updates.get(target)!.push(a._id);
    plan.byTargetModule[target]++;

    const tk = String(a.tenantId);
    plan.perTenant[tk] ??= { CREDIT: 0, DI: 0, SUB_AGENT: 0, CASH: 0 };
    plan.perTenant[tk][target as 'CREDIT' | 'DI' | 'SUB_AGENT']++;
  }

  return { plan, updates };
}

async function apply(updates: Map<AgencyModule, mongoose.Types.ObjectId[]>): Promise<void> {
  for (const [target, ids] of updates.entries()) {
    if (ids.length === 0) continue;
    const res = await Agency.updateMany(
      { _id: { $in: ids } },
      { $set: { module: target } },
    );
    logger.info(
      { target, matched: res.matchedCount, modified: res.modifiedCount },
      'backfill-agency-module: wrote',
    );
  }
}

async function main(): Promise<void> {
  const isApply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGO_URI);
  logger.info({ apply: isApply }, 'backfill-agency-module: start');

  const { plan, updates } = await classify();

  logger.info(
    {
      total: plan.total,
      byTargetModule: plan.byTargetModule,
      skippedNonCash: plan.skippedNonCash,
      tenants: Object.keys(plan.perTenant).length,
    },
    'backfill-agency-module: classification plan',
  );

  // Detail per-tenant — useful when one tenant has unexpected DI/CREDIT
  // counts and ops wants to drill in.
  for (const [tenantId, counts] of Object.entries(plan.perTenant)) {
    logger.info({ tenantId, ...counts }, 'backfill-agency-module: tenant breakdown');
  }

  if (!isApply) {
    logger.warn('backfill-agency-module: dry run — pass --apply to write changes');
    await mongoose.disconnect();
    return;
  }

  await apply(updates);
  logger.info('backfill-agency-module: complete');
  await mongoose.disconnect();
}

void main().catch((err) => {
  logger.error({ err }, 'backfill-agency-module: failed');
  process.exitCode = 1;
});
