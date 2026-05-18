import { computeMarkupPaise, pickRulesByScope } from './condition-matcher.js';
import type { PricingInput, PricingResult, PricingTraceStep } from './types.js';

// priceFare — pure orchestrator over the supplier fare.
// Inputs: paise integers + condition metadata. Outputs: a full breakdown + trace.
// Every step records its before/after, so audit can replay the exact arithmetic later.
export function priceFare(input: PricingInput): PricingResult {
  if (!Number.isInteger(input.baseFarePaise) || input.baseFarePaise < 0) {
    throw new Error('baseFarePaise must be a non-negative integer');
  }
  if (!Number.isInteger(input.taxesPaise) || input.taxesPaise < 0) {
    throw new Error('taxesPaise must be a non-negative integer');
  }

  const trace: PricingTraceStep[] = [];
  const baseFarePaise = input.baseFarePaise;
  const taxesPaise = input.taxesPaise;

  let running = baseFarePaise;
  trace.push({
    step: 'init.baseFare',
    beforePaise: 0,
    afterPaise: running,
    deltaPaise: running,
    notes: 'baseFare from supplier',
  });

  // ── 1. Policy ────────────────────────────────────────────────────────────
  // Commission: supplier owes us a % off the base fare. We don't *subtract* from the
  // gross — we record it as platform earnings carved out of the supplier's net.
  // Management fee + b2bMarkup add to the price the agency pays.
  let policyAdjustment = 0;
  if (input.policy) {
    if (input.policy.b2bMarkupPaise > 0) {
      const before = running;
      running += input.policy.b2bMarkupPaise;
      policyAdjustment += input.policy.b2bMarkupPaise;
      trace.push({
        step: 'policy.b2bMarkup',
        beforePaise: before,
        afterPaise: running,
        deltaPaise: input.policy.b2bMarkupPaise,
      });
    }
    if (input.policy.managementFeePaise > 0) {
      const before = running;
      running += input.policy.managementFeePaise;
      policyAdjustment += input.policy.managementFeePaise;
      trace.push({
        step: 'policy.managementFee',
        beforePaise: before,
        afterPaise: running,
        deltaPaise: input.policy.managementFeePaise,
      });
    }
  }

  // ── 2. Markup rules ──────────────────────────────────────────────────────
  // Pick the winning rule per scope and apply in PLATFORM → DISTRIBUTOR → AGENCY order.
  // Each later scope marks up against the running total, so the chain compounds.
  const winners = pickRulesByScope(input.markupRules ?? [], input);

  let platformMarkup = 0;
  let distributorMarkup = 0;
  let agencyMarkup = 0;

  if (winners.platform) {
    const before = running;
    platformMarkup = computeMarkupPaise(winners.platform, running);
    running += platformMarkup;
    trace.push({
      step: 'markup.platform',
      ruleId: winners.platform.id,
      ruleName: winners.platform.name,
      beforePaise: before,
      afterPaise: running,
      deltaPaise: platformMarkup,
    });
  }

  if (winners.distributor) {
    const before = running;
    distributorMarkup = computeMarkupPaise(winners.distributor, running);
    running += distributorMarkup;
    trace.push({
      step: 'markup.distributor',
      ruleId: winners.distributor.id,
      ruleName: winners.distributor.name,
      beforePaise: before,
      afterPaise: running,
      deltaPaise: distributorMarkup,
    });
  }

  if (winners.agency) {
    const before = running;
    agencyMarkup = computeMarkupPaise(winners.agency, running);
    running += agencyMarkup;
    trace.push({
      step: 'markup.agency',
      ruleId: winners.agency.id,
      ruleName: winners.agency.name,
      beforePaise: before,
      afterPaise: running,
      deltaPaise: agencyMarkup,
    });
  }

  // ── 3. Discount ──────────────────────────────────────────────────────────
  // Discounts are subtracted from the running total but never below zero.
  let discountPaise = 0;
  if (input.discountPaise && input.discountPaise > 0) {
    const before = running;
    discountPaise = Math.min(input.discountPaise, running);
    running -= discountPaise;
    trace.push({
      step: 'discount',
      beforePaise: before,
      afterPaise: running,
      deltaPaise: -discountPaise,
    });
  }

  // ── 4. Taxes (pass-through) ──────────────────────────────────────────────
  // Supplier taxes ride on top — already collected from end traveler — they aren't marked up.
  const beforeTax = running;
  running += taxesPaise;
  if (taxesPaise > 0) {
    trace.push({
      step: 'taxes.passthrough',
      beforePaise: beforeTax,
      afterPaise: running,
      deltaPaise: taxesPaise,
    });
  }

  // ── 5. GST ───────────────────────────────────────────────────────────────
  // gstOnMarkupOnly === true → tax just the markup chain (incl. policy adj).
  // gstOnMarkupOnly === false → tax the entire pre-tax line item including the base.
  let gstPaise = 0;
  if (input.policy && input.policy.gstRateBasisPoints > 0) {
    const taxableBase = input.policy.gstOnMarkupOnly
      ? policyAdjustment + platformMarkup + distributorMarkup + agencyMarkup
      : running - taxesPaise;
    if (taxableBase > 0) {
      gstPaise = Math.round((taxableBase * input.policy.gstRateBasisPoints) / 10000);
      const before = running;
      running += gstPaise;
      trace.push({
        step: 'gst',
        beforePaise: before,
        afterPaise: running,
        deltaPaise: gstPaise,
        notes: input.policy.gstOnMarkupOnly ? 'on markup only' : 'on full pre-tax',
      });
    }
  }

  const grossAmountPaise = running;

  // ── 6. Settlement allocations ────────────────────────────────────────────
  // Net to supplier = baseFare minus the commission they owe us (recovered via policy).
  const commissionPaise =
    input.policy && input.policy.commissionPercent > 0
      ? Math.round((baseFarePaise * input.policy.commissionPercent) / 10000)
      : 0;
  if (commissionPaise > 0) {
    trace.push({
      step: 'settlement.commission',
      beforePaise: baseFarePaise,
      afterPaise: baseFarePaise - commissionPaise,
      deltaPaise: -commissionPaise,
      notes: 'commission carved out of supplier remit',
    });
  }
  const netToSupplierPaise = baseFarePaise - commissionPaise + taxesPaise;

  // Agency pays gross minus its own markup retained margin.
  const agencyPayablePaise = grossAmountPaise - agencyMarkup;

  // Earnings allocation: distributor keeps its own markup; platform keeps everything else.
  const distributorEarningsPaise = distributorMarkup;
  const platformEarningsPaise = commissionPaise + policyAdjustment + platformMarkup + gstPaise;

  return {
    baseFarePaise,
    taxesPaise,
    policyAdjustmentPaise: policyAdjustment,
    platformMarkupPaise: platformMarkup,
    distributorMarkupPaise: distributorMarkup,
    agencyMarkupPaise: agencyMarkup,
    discountPaise,
    gstPaise,
    grossAmountPaise,
    netToSupplierPaise,
    agencyPayablePaise,
    distributorEarningsPaise,
    platformEarningsPaise,
    trace,
  };
}
