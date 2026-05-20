import mongoose from 'mongoose';
import {
  AppError,
  CODE_PREFIX,
  type CreateAgencyRequest,
  type UpdateAgencyRequest,
} from '@tripbng/shared';
import { Agency, type AgencyDoc } from '../models/Agency.js';
import { Distributor } from '../models/Distributor.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { nextCode } from '../utils/codes.js';

export async function createAgency(
  tenantId: string,
  input: CreateAgencyRequest,
  createdBy?: string,
): Promise<{ agency: AgencyDoc; ownerUserId: string }> {
  if (input.distributorId) {
    const dist = await Distributor.findOne({ _id: input.distributorId, tenantId }).lean();
    if (!dist) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  }

  const conflict = await User.findOne({
    tenantId,
    $or: [{ email: input.owner.email }, { mobile: input.owner.mobile }],
  }).lean();
  if (conflict) {
    throw new AppError(conflict.email === input.owner.email ? 'EMAIL_TAKEN' : 'MOBILE_TAKEN');
  }

  const session = await mongoose.startSession();
  try {
    let agencyDoc: AgencyDoc | undefined;
    let ownerId: string | undefined;
    await session.withTransaction(async () => {
      const passwordHash = await hashPassword(input.owner.password);
      const userCode = await nextCode(CODE_PREFIX.AGENCY);
      const agencyCode = await nextCode(CODE_PREFIX.AGENCY);

      const ownerArr = await User.create(
        [
          {
            tenantId,
            userCode,
            role: 'AGENCY',
            email: input.owner.email,
            mobile: input.owner.mobile,
            fullName: input.owner.fullName,
            passwordHash,
            distributorId: input.distributorId ?? null,
            status: 'ACTIVE',
            createdBy: createdBy ?? null,
          },
        ],
        { session },
      );
      const owner = ownerArr[0];
      if (!owner) throw new AppError('INTERNAL_ERROR');

      const agencyArr = await Agency.create(
        [
          {
            tenantId,
            agencyCode,
            companyName: input.companyName,
            legalName: input.legalName ?? null,
            country: input.country,
            state: input.state,
            city: input.city,
            pincode: input.pincode,
            address: input.address,
            distributorId: input.distributorId ?? null,
            ownerUserId: owner._id,
            pan: input.pan ?? undefined,
            gst: input.gst ?? undefined,
            status: 'ACTIVE',
            createdBy: createdBy ?? null,
          },
        ],
        { session },
      );
      const agency = agencyArr[0];
      if (!agency) throw new AppError('INTERNAL_ERROR');

      owner.agencyId = agency._id;
      await owner.save({ session });

      if (input.distributorId) {
        await Distributor.updateOne(
          { _id: input.distributorId },
          { $inc: { agencyCount: 1 } },
          { session },
        );
      }
      agencyDoc = agency;
      ownerId = String(owner._id);
    });
    if (!agencyDoc || !ownerId) throw new AppError('INTERNAL_ERROR');
    return { agency: agencyDoc, ownerUserId: ownerId };
  } finally {
    await session.endSession();
  }
}

export async function updateAgency(
  agencyId: string,
  input: UpdateAgencyRequest,
  updatedBy?: string,
): Promise<AgencyDoc> {
  const agency = await Agency.findById(agencyId);
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');

  if (input.companyName !== undefined) agency.companyName = input.companyName;
  if (input.legalName !== undefined) agency.legalName = input.legalName;
  if (input.state !== undefined) agency.state = input.state;
  if (input.city !== undefined) agency.city = input.city;
  if (input.pincode !== undefined) agency.pincode = input.pincode;
  if (input.address !== undefined) agency.address = input.address;
  if (input.status !== undefined) agency.status = input.status;
  if (input.blockedReason !== undefined) agency.blockedReason = input.blockedReason;
  if (input.creditLimit !== undefined) agency.creditLimit = input.creditLimit;
  if (input.managementFee !== undefined) agency.managementFee = input.managementFee;
  if (input.manageMarkup !== undefined) agency.manageMarkup = input.manageMarkup;
  agency.updatedBy = updatedBy
    ? (updatedBy as unknown as typeof agency.updatedBy)
    : agency.updatedBy;

  await agency.save();
  return agency;
}

/**
 * Serialize an Agency for public API responses.
 *
 * `walletBalanceOverride` — Phase-15 cutover plumbing. When provided, this
 * value (resolved from the canonical `Wallet.balance` via
 * services/wallet/balance-reader) overrides the legacy
 * `Agency.walletBalance` field. List/get routes pass the pre-resolved value
 * in so list views don't need a wallet lookup per row. Single-agency callers
 * that haven't migrated yet still read the legacy field — same value during
 * the dual-write window, drops automatically once we delete the field.
 */
export function serializeAgency(
  agency: AgencyDoc,
  opts: { walletBalanceOverride?: number } = {},
) {
  return {
    id: String(agency._id),
    agencyCode: agency.agencyCode,
    companyName: agency.companyName,
    legalName: agency.legalName,
    country: agency.country,
    state: agency.state,
    city: agency.city,
    pincode: agency.pincode,
    address: agency.address,
    distributorId: agency.distributorId ? String(agency.distributorId) : null,
    walletBalance: opts.walletBalanceOverride ?? agency.walletBalance,
    creditLimit: agency.creditLimit,
    outstandingAmount: agency.outstandingAmount,
    status: agency.status,
    ownerUserId: String(agency.ownerUserId),
    createdAt: agency.createdAt.toISOString(),
    updatedAt: agency.updatedAt.toISOString(),
  };
}
