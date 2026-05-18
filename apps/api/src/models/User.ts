import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { ROLES, USER_STATUS } from '@tripbng/shared';

const UserSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userCode: { type: String, required: true, unique: true, index: true },

    role: { type: String, enum: ROLES, required: true, index: true },

    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, required: true, trim: true, index: true },
    fullName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },

    pan: {
      number: { type: String, select: false },
      name: { type: String },
      imageUrl: { type: String },
      verifiedAt: { type: Date },
    },
    gst: {
      number: { type: String },
      imageUrl: { type: String },
      verifiedAt: { type: Date },
    },

    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    status: { type: String, enum: USER_STATUS, default: 'PENDING', index: true },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },

    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    pendingTwoFactorSecret: { type: String, select: false },

    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },

    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      language: { type: String, default: 'en' },
      timezone: { type: String, default: 'Asia/Kolkata' },
      currency: { type: String, default: 'INR' },
      notifications: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
    },

    customPermissions: [{ type: String }],
    deniedPermissions: [{ type: String }],

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1, status: 1 });

export type UserDoc = HydratedDocument<InferSchemaType<typeof UserSchema>> & {
  _id: Types.ObjectId;
};
export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc> | undefined) ?? model<UserDoc>('User', UserSchema);
