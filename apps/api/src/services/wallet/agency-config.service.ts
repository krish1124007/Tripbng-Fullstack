// Agency-config admin services — Phase-5.
//
// Three operations admins need before they can use Phase 1-4 features:
//   1. switchModule  — change Agency.module with pre-condition validation
//                      (spec §3.5). Activates CREDIT / DI behaviour.
//   2. setCreditConfig — set credit-line fields on the wallet
//                        (creditLimit, expiry, due date, block-on-due).
//   3. upsertDiConfig  — write the per-agency DepositIncentiveConfig.
//
// Concurrency
//   These are admin operations, low-frequency, single-actor. We don't take
//   the wallet lock — the writes are scoped to fields that don't conflict
//   with ledger mutations. Audit log entries are written for every change.
//
// Scope notes (Conflict 2 deferred)
//   The full spec §3.5 pre-condition matrix mentions DISTRIBUTOR ↔
//   SUB_AGENT transitions that assume Distributor is unified into Agency
//   (gap-analysis Conflict 2). We implement the conditions that work today:
//     * CREDIT → any: refuse if creditUsed > 0 (unless force=true).
//     * any → DISTRIBUTOR: log + allow; the dedicated Distributor
//       collection still owns hierarchy modelling for now.
//     * any other transitions: allowed.

import { AppError, type AgencyModule, type Role } from '@tripbng/shared';
import { Agency, type AgencyDoc } from '../../models/Agency.js';
import { Wallet } from '../../models/Wallet.js';
import {
  DepositIncentiveConfig,
  type DepositIncentiveConfigDoc,
} from '../../models/DepositIncentiveConfig.js';
import { recordAudit } from '../audit.service.js';
import { logger } from '../../config/logger.js';
import type { Types } from 'mongoose';

export interface AdminContext {
  tenantId: string;
  userId: string;
  role: Role;
  ipAddress?: string | null;
}

function assertAdmin(ctx: AdminContext): void {
  if (ctx.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', { reason: 'admin-only action' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module switch (spec §3.5)
// ─────────────────────────────────────────────────────────────────────────────

export interface SwitchModuleInput {
  agencyId: string;
  newModule: AgencyModule;
  /** Admin-override flag — bypasses CREDIT → any "creditUsed=0" check.
   *  Must be paired with a follow-up manual ADJUSTMENT_DEBIT to clear the
   *  outstanding. Admin UI surfaces this prominently. */
  force?: boolean;
  notes?: string | null;
}

export interface SwitchModuleResult {
  agency: AgencyDoc;
  previousModule: AgencyModule;
}

/**
 * Switch an agency's billing/pricing module with spec-aligned pre-conditions.
 * Writes an audit log row regardless of whether the value actually changed
 * (a no-op switch still records the operator's intent).
 */
export async function switchAgencyModule(
  ctx: AdminContext,
  input: SwitchModuleInput,
): Promise<SwitchModuleResult> {
  assertAdmin(ctx);
  const agency = await Agency.findOne({ _id: input.agencyId, tenantId: ctx.tenantId });
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');
  const previous = (agency.module ?? 'CASH') as AgencyModule;

  if (previous === input.newModule) {
    logger.info(
      { agencyId: input.agencyId, module: input.newModule },
      'agency-config: module switch is a no-op',
    );
    return { agency, previousModule: previous };
  }

  // Pre-condition: CREDIT → any requires no outstanding credit, unless the
  // admin explicitly forces (and accepts the audit trail).
  if (previous === 'CREDIT' && !input.force) {
    const wallet = await Wallet.findOne({ agencyId: input.agencyId }).lean();
    const outstanding = wallet?.creditUsed ?? 0;
    if (outstanding > 0) {
      throw new AppError('VALIDATION_ERROR', {
        reason: `agency has ₹${(outstanding / 100).toFixed(2)} outstanding credit — settle or force=true to override`,
        outstandingPaise: outstanding,
      });
    }
  }

  // Pre-condition: switching to DISTRIBUTOR currently warns rather than
  // blocks — the dedicated Distributor collection still owns hierarchy.
  // The Conflict-2 follow-up will tighten this (require sub-agent migration).
  if (input.newModule === 'DISTRIBUTOR') {
    logger.warn(
      { agencyId: input.agencyId },
      'agency-config: switching to DISTRIBUTOR — verify hierarchy lives in Distributor collection',
    );
  }

  agency.module = input.newModule;
  // Re-evaluate the booking-gate block flag. Switching OUT of CREDIT clears
  // any credit-related block; switching INTO it leaves the block state for
  // the hourly recompute cron to set correctly.
  if (
    previous === 'CREDIT' &&
    (agency.blockReason === 'CREDIT_LIMIT' ||
      agency.blockReason === 'CREDIT_EXPIRED' ||
      agency.blockReason === 'DUE_DATE_CROSSED')
  ) {
    agency.bookingBlocked = false;
    agency.blockReason = null;
  }
  await agency.save();

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'agency.module.switch',
    resource: 'agency',
    resourceId: String(agency._id),
    before: { module: previous },
    after: { module: input.newModule, force: !!input.force, notes: input.notes ?? null },
    ip: ctx.ipAddress ?? null,
  });

  return { agency, previousModule: previous };
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit-line config (spec §6.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface SetCreditConfigInput {
  agencyId: string;
  creditLimitPaise?: number;
  /** ISO date string or null to clear. */
  creditExpiryDate?: string | null;
  /** ISO date string or null to clear. */
  creditDueDate?: string | null;
  blockOnDueDateCross?: boolean;
}

export async function setCreditConfig(
  ctx: AdminContext,
  input: SetCreditConfigInput,
): Promise<AgencyDoc> {
  assertAdmin(ctx);
  const agency = await Agency.findOne({ _id: input.agencyId, tenantId: ctx.tenantId });
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');

  const before = {
    creditLimit: agency.creditLimit,
    creditExpiryDate: agency.creditExpiryDate,
    creditDueDate: agency.creditDueDate,
    blockOnDueDateCross: agency.blockOnDueDateCross,
  };

  if (input.creditLimitPaise !== undefined) {
    if (!Number.isInteger(input.creditLimitPaise) || input.creditLimitPaise < 0) {
      throw new AppError('VALIDATION_ERROR', { reason: 'creditLimitPaise must be a non-negative integer' });
    }
    agency.creditLimit = input.creditLimitPaise;
  }
  if (input.creditExpiryDate !== undefined) {
    agency.creditExpiryDate = input.creditExpiryDate ? new Date(input.creditExpiryDate) : null;
  }
  if (input.creditDueDate !== undefined) {
    agency.creditDueDate = input.creditDueDate ? new Date(input.creditDueDate) : null;
  }
  if (input.blockOnDueDateCross !== undefined) {
    agency.blockOnDueDateCross = input.blockOnDueDateCross;
  }
  await agency.save();

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'agency.credit_config.set',
    resource: 'agency',
    resourceId: String(agency._id),
    before,
    after: {
      creditLimit: agency.creditLimit,
      creditExpiryDate: agency.creditExpiryDate,
      creditDueDate: agency.creditDueDate,
      blockOnDueDateCross: agency.blockOnDueDateCross,
    },
    ip: ctx.ipAddress ?? null,
  });
  return agency;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI config (spec §6.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertDiConfigInput {
  agencyId: string;
  isActive?: boolean;
  incentiveMode?: 'PERCENT' | 'ABSOLUTE';
  incentiveBasisPoints?: number | null;
  incentiveAbsolutePaise?: number | null;
  minDepositForIncentivePaise?: number | null;
  maxIncentivePerTxnPaise?: number | null;
  tdsApplicable?: boolean;
  tdsBasisPoints?: number;
  validFrom?: string;
  validTo?: string | null;
}

/**
 * Upsert the per-agency DI config. When no row exists for the agency, a new
 * one is created (with sensible defaults: PERCENT mode, TDS at 200 bp).
 * When a row exists, only the provided fields are updated.
 *
 * Note: the partial-unique index `(tenantId, agencyId, isActive=true)` means
 * an agency can have at most ONE active row at a time. To roll back to the
 * tenant-default config, set isActive=false on the agency-specific row.
 */
export async function upsertDiConfig(
  ctx: AdminContext,
  input: UpsertDiConfigInput,
): Promise<DepositIncentiveConfigDoc> {
  assertAdmin(ctx);
  const agency = await Agency.findOne({ _id: input.agencyId, tenantId: ctx.tenantId })
    .select('_id')
    .lean();
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');

  const existing = await DepositIncentiveConfig.findOne({
    tenantId: ctx.tenantId,
    agencyId: input.agencyId,
  });

  const updates: Record<string, unknown> = {};
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.incentiveMode !== undefined) updates.incentiveMode = input.incentiveMode;
  if (input.incentiveBasisPoints !== undefined)
    updates.incentiveBasisPoints = input.incentiveBasisPoints;
  if (input.incentiveAbsolutePaise !== undefined)
    updates.incentiveAbsolutePaise = input.incentiveAbsolutePaise;
  if (input.minDepositForIncentivePaise !== undefined)
    updates.minDepositForIncentivePaise = input.minDepositForIncentivePaise;
  if (input.maxIncentivePerTxnPaise !== undefined)
    updates.maxIncentivePerTxnPaise = input.maxIncentivePerTxnPaise;
  if (input.tdsApplicable !== undefined) updates.tdsApplicable = input.tdsApplicable;
  if (input.tdsBasisPoints !== undefined) updates.tdsBasisPoints = input.tdsBasisPoints;
  if (input.validFrom !== undefined) updates.validFrom = new Date(input.validFrom);
  if (input.validTo !== undefined) updates.validTo = input.validTo ? new Date(input.validTo) : null;
  updates.updatedBy = ctx.userId as unknown as Types.ObjectId;

  let config: DepositIncentiveConfigDoc;
  if (existing) {
    const before = existing.toObject();
    Object.assign(existing, updates);
    await existing.save();
    config = existing;
    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'agency.di_config.update',
      resource: 'deposit-incentive-config',
      resourceId: String(existing._id),
      before,
      after: existing.toObject(),
      ip: ctx.ipAddress ?? null,
    });
  } else {
    // Sensible defaults when this is the first-ever config for the agency.
    config = await DepositIncentiveConfig.create({
      tenantId: ctx.tenantId,
      agencyId: input.agencyId,
      isActive: input.isActive ?? true,
      incentiveMode: input.incentiveMode ?? 'PERCENT',
      incentiveBasisPoints: input.incentiveBasisPoints ?? 100,
      incentiveAbsolutePaise: input.incentiveAbsolutePaise ?? null,
      minDepositForIncentivePaise: input.minDepositForIncentivePaise ?? null,
      maxIncentivePerTxnPaise: input.maxIncentivePerTxnPaise ?? null,
      tdsApplicable: input.tdsApplicable ?? true,
      tdsBasisPoints: input.tdsBasisPoints ?? 200,
      validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
      validTo: input.validTo ? new Date(input.validTo) : null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'agency.di_config.create',
      resource: 'deposit-incentive-config',
      resourceId: String(config._id),
      after: config.toObject(),
      ip: ctx.ipAddress ?? null,
    });
  }
  return config;
}
