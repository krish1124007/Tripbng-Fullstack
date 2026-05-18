import { z } from 'zod';

export const SUPPLIER_TYPE = ['OTA', 'CONSOLIDATOR', 'DIRECT', 'GDS', 'IN_HOUSE'] as const;
export type SupplierType = (typeof SUPPLIER_TYPE)[number];

export const SUPPLIER_STATUS = ['ACTIVE', 'PAUSED', 'DISABLED'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUS)[number];

export const PRODUCT_TYPE = ['FLIGHT', 'HOTEL', 'BUS', 'VISA'] as const;
export type ProductType = (typeof PRODUCT_TYPE)[number];

export const SupplierCapabilitiesSchema = z.object({
  search: z.boolean().default(true),
  book: z.boolean().default(true),
  hold: z.boolean().default(false),
  cancel: z.boolean().default(true),
  reschedule: z.boolean().default(false),
  webCheckin: z.boolean().default(false),
});

export const SupplierConfigSchema = z.object({
  endpoint: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  apiKey: z.string().optional(),
  agentId: z.string().optional(),
  extra: z.record(z.unknown()).optional(),
});

export const CreateSupplierRequestSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, digits, hyphens, underscores'),
  name: z.string().min(2).max(120),
  type: z.enum(SUPPLIER_TYPE),
  productTypes: z.array(z.enum(PRODUCT_TYPE)).min(1),
  config: SupplierConfigSchema,
  capabilities: SupplierCapabilitiesSchema.optional(),
  supportedAirlines: z.array(z.string()).optional(),
  status: z.enum(SUPPLIER_STATUS).default('ACTIVE'),
  notes: z.string().max(500).optional(),
});
export type CreateSupplierRequest = z.infer<typeof CreateSupplierRequestSchema>;

export const UpdateSupplierRequestSchema = CreateSupplierRequestSchema.partial();
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequestSchema>;

export const PublicSupplierSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.enum(SUPPLIER_TYPE),
  productTypes: z.array(z.enum(PRODUCT_TYPE)),
  capabilities: SupplierCapabilitiesSchema,
  supportedAirlines: z.array(z.string()),
  status: z.enum(SUPPLIER_STATUS),
  configEndpoint: z.string(),
  notes: z.string().nullable(),
  lastHealthCheckAt: z.string().datetime().nullable(),
  lastHealthCheckOk: z.boolean().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicSupplier = z.infer<typeof PublicSupplierSchema>;

export const SupplierSourceTravelType = ['DOMESTIC', 'INTERNATIONAL', 'BOTH'] as const;
export type SupplierSourceTravelTypeT = (typeof SupplierSourceTravelType)[number];

export const CreateSupplierSourceSchema = z.object({
  supplierId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  productType: z.enum(PRODUCT_TYPE),
  travelType: z.enum(SupplierSourceTravelType),
  airlineCodes: z.array(z.string()).default([]),
  priority: z.number().int().min(0).default(100),
  enabled: z.boolean().default(true),
});
export type CreateSupplierSource = z.infer<typeof CreateSupplierSourceSchema>;

export const UpdateSupplierSourceSchema = CreateSupplierSourceSchema.partial();
export type UpdateSupplierSource = z.infer<typeof UpdateSupplierSourceSchema>;
