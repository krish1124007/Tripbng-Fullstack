import { AppError, type CreateUserRequest, type UpdateUserRequest } from '@tripbng/shared';
import { User, type UserDoc } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { nextCode } from '../utils/codes.js';
import { CODE_PREFIX, type Role } from '@tripbng/shared';

const ROLE_TO_PREFIX: Record<Role, keyof typeof CODE_PREFIX> = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  AGENCY: 'AGENCY',
  SUB_AGENT: 'SUB_AGENT',
  DISTRIBUTOR: 'DISTRIBUTOR',
  SUPPLIER: 'SUPPLIER',
  ACCOUNTS_USER: 'ACCOUNTS_USER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
};

export async function createUser(
  tenantId: string,
  input: CreateUserRequest,
  createdBy?: string,
): Promise<UserDoc> {
  // Role-context guard: agency/sub-agent users MUST be linked to an Agency,
  // distributors MUST be linked to a Distributor. Without this every booking
  // attempt later 400s with "Bookings require an agency wallet context" and
  // the operator has no idea why — the user looks like an agency in the UI
  // (correct userCode prefix, correct role) but the wallet-bearing link
  // is null. Caught here so it's caught at create-time, not 3 weeks later
  // when someone tries to ticket their first booking.
  if ((input.role === 'AGENCY' || input.role === 'SUB_AGENT') && !input.agencyId) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `role=${input.role} users must be linked to an agency — set agencyId`,
    });
  }
  if (input.role === 'DISTRIBUTOR' && !input.distributorId) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'role=DISTRIBUTOR users must be linked to a distributor — set distributorId',
    });
  }

  const existing = await User.findOne({
    tenantId,
    $or: [{ email: input.email }, { mobile: input.mobile }],
  }).lean();
  if (existing) {
    throw new AppError(existing.email === input.email ? 'EMAIL_TAKEN' : 'MOBILE_TAKEN');
  }

  const passwordHash = await hashPassword(input.password);
  const userCode = await nextCode(CODE_PREFIX[ROLE_TO_PREFIX[input.role]]);

  const user = await User.create({
    tenantId,
    userCode,
    role: input.role,
    email: input.email,
    mobile: input.mobile,
    fullName: input.fullName,
    passwordHash,
    agencyId: input.agencyId ?? null,
    distributorId: input.distributorId ?? null,
    status: 'ACTIVE',
    createdBy: createdBy ?? null,
  });
  return user;
}

export async function updateUser(
  userId: string,
  input: UpdateUserRequest,
  updatedBy?: string,
): Promise<UserDoc> {
  const user = await User.findById(userId);
  if (!user) throw new AppError('USER_NOT_FOUND');

  if (input.fullName !== undefined) user.fullName = input.fullName;
  if (input.mobile !== undefined) user.mobile = input.mobile;
  if (input.status !== undefined) user.status = input.status;
  if (input.customPermissions !== undefined) user.customPermissions = input.customPermissions;
  if (input.deniedPermissions !== undefined) user.deniedPermissions = input.deniedPermissions;
  if (input.preferences && user.preferences) {
    Object.assign(user.preferences, input.preferences);
    user.markModified('preferences');
  }
  user.updatedBy = updatedBy ? (updatedBy as unknown as typeof user.updatedBy) : user.updatedBy;
  await user.save();
  return user;
}

export function serializeUser(user: UserDoc) {
  return {
    id: String(user._id),
    userCode: user.userCode,
    email: user.email,
    mobile: user.mobile,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    agencyId: user.agencyId ? String(user.agencyId) : null,
    distributorId: user.distributorId ? String(user.distributorId) : null,
    twoFactorEnabled: user.twoFactorEnabled,
    preferences: user.preferences,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
