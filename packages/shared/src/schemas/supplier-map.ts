import { z } from 'zod';
import { PRODUCT_TYPE } from './supplier.js';

// ────────── Supplier Map (Module 3 — the rules-engine config) ──────────
//
// A SupplierMap row is one rule that grants a set of suppliers visibility to a
// set of agency groups, for a product type + travel type, optionally narrowed
// by airline and a travel-date window. The flight-search resolver evaluates
// these rows as the "Mapping Allowed" + "Agency Authorized" layers of the
// 4-layer access check (see services/supplier-access).
//
// Empty arrays mean "no restriction on this dimension":
//   supplierIds:    [] → applies to every supplier
//   agencyGroupIds: [] → visible to every agency group
//   airlineCodes:   [] → all airlines allowed
//
// When a tenant has zero ACTIVE rows for a product type, the resolver runs
// fail-open (every active+sourced supplier is visible) so search keeps working
// until an admin configures the map.

export const SUPPLIER_MAP_TRAVEL_TYPE = ['DOMESTIC', 'INTERNATIONAL', 'BOTH'] as const;
export type SupplierMapTravelType = (typeof SUPPLIER_MAP_TRAVEL_TYPE)[number];

export const SUPPLIER_MAP_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type SupplierMapStatus = (typeof SUPPLIER_MAP_STATUS)[number];

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char ObjectId');
const airlineCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(3)
  .regex(/^[A-Z0-9]+$/, 'IATA airline code');

export const CreateSupplierMapSchema = z
  .object({
    name: z.string().min(2).max(120),
    productType: z.enum(PRODUCT_TYPE).default('FLIGHT'),
    travelType: z.enum(SUPPLIER_MAP_TRAVEL_TYPE).default('BOTH'),

    /** Empty = every supplier this rule's other dimensions match. */
    supplierIds: z.array(objectId).default([]),
    /** Empty = visible to every agency group. */
    agencyGroupIds: z.array(objectId).default([]),
    /** Empty = all airlines allowed; otherwise an allow-list. */
    airlineCodes: z.array(airlineCode).default([]),

    /** Inclusive travel-date window. null bounds are open-ended. */
    dateStart: z.coerce.date().nullable().default(null),
    dateEnd: z.coerce.date().nullable().default(null),

    /** When true, hold/pending fares from matched suppliers are allowed. */
    allowPendingBooking: z.boolean().default(false),

    priority: z.number().int().min(0).default(100),
    status: z.enum(SUPPLIER_MAP_STATUS).default('ACTIVE'),
  })
  .refine((d) => !d.dateStart || !d.dateEnd || d.dateStart <= d.dateEnd, {
    message: 'dateStart must be on or before dateEnd',
    path: ['dateEnd'],
  });
export type CreateSupplierMap = z.infer<typeof CreateSupplierMapSchema>;

// Partial update — re-validate the date-window invariant when both are present.
export const UpdateSupplierMapSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    productType: z.enum(PRODUCT_TYPE).optional(),
    travelType: z.enum(SUPPLIER_MAP_TRAVEL_TYPE).optional(),
    supplierIds: z.array(objectId).optional(),
    agencyGroupIds: z.array(objectId).optional(),
    airlineCodes: z.array(airlineCode).optional(),
    dateStart: z.coerce.date().nullable().optional(),
    dateEnd: z.coerce.date().nullable().optional(),
    allowPendingBooking: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
    status: z.enum(SUPPLIER_MAP_STATUS).optional(),
  })
  .refine((d) => !d.dateStart || !d.dateEnd || d.dateStart <= d.dateEnd, {
    message: 'dateStart must be on or before dateEnd',
    path: ['dateEnd'],
  });
export type UpdateSupplierMap = z.infer<typeof UpdateSupplierMapSchema>;

export const PublicSupplierMapSchema = z.object({
  id: z.string(),
  name: z.string(),
  productType: z.enum(PRODUCT_TYPE),
  travelType: z.enum(SUPPLIER_MAP_TRAVEL_TYPE),
  supplierIds: z.array(z.string()),
  agencyGroupIds: z.array(z.string()),
  airlineCodes: z.array(z.string()),
  dateStart: z.string().datetime().nullable(),
  dateEnd: z.string().datetime().nullable(),
  allowPendingBooking: z.boolean(),
  priority: z.number().int(),
  status: z.enum(SUPPLIER_MAP_STATUS),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicSupplierMap = z.infer<typeof PublicSupplierMapSchema>;
