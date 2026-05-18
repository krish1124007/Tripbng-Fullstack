import mongoose from 'mongoose';
import {
  AppError,
  CODE_PREFIX,
  type CreateDistributorRequest,
  type UpdateDistributorRequest,
} from '@tripbng/shared';
import { Distributor, type DistributorDoc } from '../models/Distributor.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { nextCode } from '../utils/codes.js';

export async function createDistributor(
  tenantId: string,
  input: CreateDistributorRequest,
  createdBy?: string,
): Promise<{ distributor: DistributorDoc; ownerUserId: string }> {
  const conflict = await User.findOne({
    tenantId,
    $or: [{ email: input.owner.email }, { mobile: input.owner.mobile }],
  }).lean();
  if (conflict) {
    throw new AppError(conflict.email === input.owner.email ? 'EMAIL_TAKEN' : 'MOBILE_TAKEN');
  }

  const session = await mongoose.startSession();
  try {
    let distDoc: DistributorDoc | undefined;
    let ownerId: string | undefined;
    await session.withTransaction(async () => {
      const passwordHash = await hashPassword(input.owner.password);
      const userCode = await nextCode(CODE_PREFIX.DISTRIBUTOR);
      const distributorCode = await nextCode(CODE_PREFIX.DISTRIBUTOR);

      const ownerArr = await User.create(
        [
          {
            tenantId,
            userCode,
            role: 'DISTRIBUTOR',
            email: input.owner.email,
            mobile: input.owner.mobile,
            fullName: input.owner.fullName,
            passwordHash,
            status: 'ACTIVE',
            createdBy: createdBy ?? null,
          },
        ],
        { session },
      );
      const owner = ownerArr[0];
      if (!owner) throw new AppError('INTERNAL_ERROR');

      const distArr = await Distributor.create(
        [
          {
            tenantId,
            distributorCode,
            companyName: input.companyName,
            legalName: input.legalName ?? null,
            country: input.country,
            state: input.state,
            city: input.city,
            pincode: input.pincode,
            address: input.address,
            overrideCommissionPercent: input.overrideCommissionPercent ?? 0,
            ownerUserId: owner._id,
            pan: input.pan ?? undefined,
            status: 'ACTIVE',
            createdBy: createdBy ?? null,
          },
        ],
        { session },
      );
      const distributor = distArr[0];
      if (!distributor) throw new AppError('INTERNAL_ERROR');

      owner.distributorId = distributor._id;
      await owner.save({ session });

      distDoc = distributor;
      ownerId = String(owner._id);
    });
    if (!distDoc || !ownerId) throw new AppError('INTERNAL_ERROR');
    return { distributor: distDoc, ownerUserId: ownerId };
  } finally {
    await session.endSession();
  }
}

export async function updateDistributor(
  distributorId: string,
  input: UpdateDistributorRequest,
  updatedBy?: string,
): Promise<DistributorDoc> {
  const dist = await Distributor.findById(distributorId);
  if (!dist) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  if (input.companyName !== undefined) dist.companyName = input.companyName;
  if (input.legalName !== undefined) dist.legalName = input.legalName;
  if (input.state !== undefined) dist.state = input.state;
  if (input.city !== undefined) dist.city = input.city;
  if (input.pincode !== undefined) dist.pincode = input.pincode;
  if (input.address !== undefined) dist.address = input.address;
  if (input.status !== undefined) dist.status = input.status;
  if (input.overrideCommissionPercent !== undefined)
    dist.overrideCommissionPercent = input.overrideCommissionPercent;
  dist.updatedBy = updatedBy ? (updatedBy as unknown as typeof dist.updatedBy) : dist.updatedBy;
  await dist.save();
  return dist;
}

export function serializeDistributor(d: DistributorDoc) {
  return {
    id: String(d._id),
    distributorCode: d.distributorCode,
    companyName: d.companyName,
    legalName: d.legalName,
    country: d.country,
    state: d.state,
    city: d.city,
    pincode: d.pincode,
    address: d.address,
    overrideCommissionPercent: d.overrideCommissionPercent,
    status: d.status,
    ownerUserId: String(d.ownerUserId),
    agencyCount: d.agencyCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
