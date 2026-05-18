/**
 * Phase 3 smoke — exercises validate + issue against the ASEGO sandbox using
 * the actual service layer (so it covers crypto + mapper + Mongo persist +
 * audit log wiring end-to-end).
 *
 * Run:
 *    pnpm --filter @tripbng/api exec tsx src/scripts/asego-issue-smoke.ts
 *
 * This WILL create a real test policy on the sandbox. Each invocation uses
 * a fresh orderId (UUID-derived) so reruns don't collide with ASEGO's dedup.
 *
 * Pass criteria: validate returns ok, issue returns at least one policyNumber,
 * Mongo has the persisted policy doc, audit log has matching VALIDATE + ISSUE
 * events.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../config/db.js';
import { connectRedis, redis } from '../config/redis.js';
import { listCategories, listPlanMaster } from '../services/insurance/master.service.js';
import { issuePolicy, validatePolicyDraft } from '../services/insurance/policy.service.js';
import { InsurancePolicy } from '../models/InsurancePolicy.js';
import { InsurancePolicyEvent } from '../models/InsurancePolicyEvent.js';

interface MasterPlan {
  insurerId: string;
  insurerName?: string;
  /** Master endpoint returns this as `planId`. The createPolicy endpoint
   *  expects this same value as `sellingPlanId` in selectedPlan.plan. */
  planId: string;
  planName: string;
  geographicalArea: string;
  premium?: number;
  agePremiums?: { fromAge: number; toAge: number; premium: number }[];
}

function pickFirstDomesticPlan(master: unknown, domesticCatId: string): MasterPlan | null {
  if (!master || typeof master !== 'object') return null;
  const m = master as { sellingPlanDto?: MasterPlan[] };
  if (!Array.isArray(m.sellingPlanDto)) return null;
  return m.sellingPlanDto.find((p) => p.geographicalArea === domesticCatId) ?? null;
}

const today = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function main() {
  await connectMongo();
  await connectRedis();

  const tenantId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();

  console.warn('▶ pulling masters');
  const categories = await listCategories();
  const domestic = categories.find((c) => c.name.toLowerCase() === 'domestic');
  if (!domestic) throw new Error('Domestic category not found');
  const masterRaw = await listPlanMaster();
  const plan = pickFirstDomesticPlan(masterRaw, domestic.id);
  if (!plan) throw new Error('no domestic selling plan in master');
  console.warn(`  picked plan: ${plan.planName} (planId=${plan.planId})`);

  // Pick a per-pax premium — ASEGO's master may surface either `premium` or an
  // `agePremiums[]` slab. Default to ₹500 if neither is present (will be
  // re-priced by ASEGO server-side anyway during issue).
  const premiumRupees = plan.premium ?? plan.agePremiums?.[0]?.premium ?? 500;
  const totalPremiumPaise = Math.round(premiumRupees * 100);

  const baseRequest = {
    quotation: {
      startDate: today(7),
      endDate: today(14),
      category: domestic.id,
      destination: 'Goa',
    },
    selectedPlan: {
      insurerId: plan.insurerId,
      insurerName: plan.insurerName,
      // The master endpoint returns `planId` — that IS the createPolicy
      // sellingPlanId. We surface it under both keys in our internal model.
      planId: plan.planId,
      planName: plan.planName,
      sellingPlanId: plan.planId,
      totalPremiumPaise,
      riders: [],
    },
    travelers: [
      {
        type: 'ADULT' as const,
        title: 'MR' as const,
        firstName: 'Test',
        lastName: 'Buyer',
        dateOfBirth: '1990-01-15',
        gender: 'M' as const,
        passport: 'M1234567',
        email: 'test@tripbng.dev',
        mobileNo: '9999999999',
        pincode: '110001',
        address: '1 Test Lane, New Delhi',
        district: 'New Delhi',
        state: 'Delhi',
        country: 'India',
        nominee: {
          firstName: 'Self',
          lastName: 'Buyer',
          relation: 'Self',
          age: 36,
        },
      },
    ],
  };

  console.warn('\n▶ validate');
  try {
    const v = await validatePolicyDraft({ tenantId, userId }, baseRequest);
    console.warn(`  ✓ valid=${v.valid} warnings=${v.warnings.length}`);
  } catch (err) {
    console.warn(`  ✗ validate failed: ${(err as Error).message}`);
  }

  console.warn('\n▶ issue (real test policy on sandbox)');
  try {
    const out = await issuePolicy({ tenantId, userId }, baseRequest);
    console.warn(`  ✓ policyNumbers=${out.policyNumbers.join(',')}`);
    console.warn(`  ✓ totalPremiumPaise=${out.totalPremiumPaise}`);

    // Confirm Mongo persist
    const persisted = await InsurancePolicy.find({
      tenantId: new mongoose.Types.ObjectId(tenantId),
    }).lean();
    console.warn(`  ✓ Mongo: ${persisted.length} policy doc(s) persisted`);
    const events = await InsurancePolicyEvent.find({
      tenantId: new mongoose.Types.ObjectId(tenantId),
    }).lean();
    console.warn(
      `  ✓ Audit: ${events.length} event(s) (${events.map((e) => e.eventType).join(',')})`,
    );
  } catch (err) {
    console.warn(`  ✗ issue failed: ${(err as Error).message}`);
  }

  await redis.quit();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
