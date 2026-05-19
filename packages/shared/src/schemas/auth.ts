import { z } from 'zod';
import { EmailSchema, PasswordSchema } from './common.js';

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
  totp: z
    .string()
    .regex(/^[0-9]{6}$/)
    .optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.string(),
    userCode: z.string(),
    email: z.string(),
    fullName: z.string(),
    role: z.string(),
    agencyId: z.string().nullable(),
    distributorId: z.string().nullable(),
    twoFactorEnabled: z.boolean(),
    permissions: z.array(z.string()),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const TwoFactorSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  qrDataUrl: z.string(),
});
export type TwoFactorSetupResponse = z.infer<typeof TwoFactorSetupResponseSchema>;

export const TwoFactorVerifyRequestSchema = z.object({
  totp: z.string().regex(/^[0-9]{6}$/),
});
export type TwoFactorVerifyRequest = z.infer<typeof TwoFactorVerifyRequestSchema>;

// First-time 2FA enrolment via password (no auth token).
// Used by the /setup-2fa UI to break the chicken-and-egg in production where
// SUPER_ADMIN can't sign in without 2FA and can't enrol 2FA without signing in.
export const TwoFactorBootstrapSetupRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
export type TwoFactorBootstrapSetupRequest = z.infer<
  typeof TwoFactorBootstrapSetupRequestSchema
>;

export const TwoFactorBootstrapVerifyRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
  totp: z.string().regex(/^[0-9]{6}$/),
});
export type TwoFactorBootstrapVerifyRequest = z.infer<
  typeof TwoFactorBootstrapVerifyRequestSchema
>;
