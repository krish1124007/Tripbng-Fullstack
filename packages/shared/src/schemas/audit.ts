import { z } from 'zod';

export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  actorId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const PublicAuditLogSchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorRole: z.string().nullable(),
  impersonatorId: z.string().nullable(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  success: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type PublicAuditLog = z.infer<typeof PublicAuditLogSchema>;
