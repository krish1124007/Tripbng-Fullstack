import { z } from 'zod';
import { ROLES, USER_STATUS } from '../enums.js';
import { EmailSchema, MobileSchema, ObjectIdSchema, PasswordSchema } from './common.js';

export const PreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  language: z.string().default('en'),
  timezone: z.string().default('Asia/Kolkata'),
  currency: z.string().default('INR'),
  notifications: z
    .object({
      email: z.boolean().default(true),
      sms: z.boolean().default(true),
      push: z.boolean().default(true),
    })
    .default({}),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const CreateUserRequestSchema = z.object({
  email: EmailSchema,
  mobile: MobileSchema,
  fullName: z.string().min(2).max(120),
  password: PasswordSchema,
  role: z.enum(ROLES),
  agencyId: ObjectIdSchema.optional(),
  distributorId: ObjectIdSchema.optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  mobile: MobileSchema.optional(),
  status: z.enum(USER_STATUS).optional(),
  customPermissions: z.array(z.string()).optional(),
  deniedPermissions: z.array(z.string()).optional(),
  preferences: PreferencesSchema.partial().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const PublicUserSchema = z.object({
  id: z.string(),
  userCode: z.string(),
  email: z.string(),
  mobile: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
  status: z.enum(USER_STATUS),
  agencyId: z.string().nullable(),
  distributorId: z.string().nullable(),
  twoFactorEnabled: z.boolean(),
  preferences: PreferencesSchema,
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;
