import { z } from 'zod';
import { PAX_TYPE, TRAVEL_CLASS, TRAVEL_TYPE } from '../enums.js';

export const INVENTORY_STATUS = ['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'EXHAUSTED'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUS)[number];

export const FARE_CLASS_DESCRIPTION = ['INSTANT', 'PROMOTIONAL', 'PUBLISHED'] as const;
export type FareClassDescription = (typeof FARE_CLASS_DESCRIPTION)[number];

export const SegmentSchema = z.object({
  flightNumber: z.string().min(1).max(20),
  airline: z.object({
    code: z
      .string()
      .min(2)
      .max(3)
      .regex(/^[A-Z0-9]+$/, 'IATA airline code'),
    name: z.string().optional(),
    logo: z.string().url().optional(),
  }),
  origin: z.object({
    code: z
      .string()
      .length(3)
      .regex(/^[A-Z]+$/, 'IATA airport code'),
    terminal: z.string().optional(),
  }),
  destination: z.object({
    code: z
      .string()
      .length(3)
      .regex(/^[A-Z]+$/, 'IATA airport code'),
    terminal: z.string().optional(),
  }),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h'),
  arrivalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h'),
  nextDayArrival: z.boolean().default(false),
  duration: z.number().int().min(1, 'minutes'),
  stopOver: z.number().int().min(0).default(0),
  dayChange: z.boolean().default(false),
});
export type Segment = z.infer<typeof SegmentSchema>;

// All money fields are paise (integer).
export const FareSchema = z.object({
  adultFare: z.number().int().min(0),
  childFare: z.number().int().min(0),
  infantFare: z.number().int().min(0).default(0),
  discount: z.number().int().min(0).default(0),
  b2bMarkup: z.number().int().min(0).default(0),
  gstOnMarkup: z.boolean().default(false),
  refundable: z.boolean().default(false),
  /** Brand fare name printed prominently on the e-ticket. Snapshotted onto
   *  the Booking at booking time — never read live at render. */
  fareName: z.string().min(1).max(30).default('SkySaver'),
  /** Optional one-line summary printed under the fare name on the ticket. */
  fareNameDescription: z.string().max(80).optional(),
  fareRuleDescription: z.string().max(2000).optional(),
});
export type Fare = z.infer<typeof FareSchema>;

export const BaggageSchema = z.object({
  checkin: z.object({
    weight: z.number().min(0),
    unit: z.enum(['KG', 'PC']).default('KG'),
  }),
  handBaggage: z
    .object({
      weight: z.number().min(0),
      unit: z.enum(['KG', 'PC']).default('KG'),
    })
    .optional(),
});

export const BucketPricingItemSchema = z.object({
  fromSeat: z.number().int().min(1),
  toSeat: z.number().int().min(1),
  value: z.number().int(),
  type: z.enum(['ABSOLUTE', 'PERCENT']).default('ABSOLUTE'),
  totalAmount: z.number().int().min(0).optional(),
  gstOnDynamicFare: z.boolean().default(false),
});
export type BucketPricingItem = z.infer<typeof BucketPricingItemSchema>;

export const CreateInventoryRequestSchema = z
  .object({
    inventoryName: z.string().min(2).max(120),
    travelType: z.enum(TRAVEL_TYPE),
    travelClass: z.enum(TRAVEL_CLASS).default('ECONOMY'),

    origin: z.object({
      code: z.string().length(3),
      name: z.string().optional(),
      country: z.string().optional(),
    }),
    destination: z.object({
      code: z.string().length(3),
      name: z.string().optional(),
      country: z.string().optional(),
    }),

    seriesStartDate: z.coerce.date(),
    seriesEndDate: z.coerce.date(),
    scheduleFrom: z.coerce.date().optional(),
    scheduleTo: z.coerce.date().optional(),

    daysOfOperation: z.array(z.number().int().min(0).max(6)).min(1, 'Select at least one day'),

    totalSeats: z.number().int().min(1),
    seatsPerDay: z.number().int().min(1),
    closeBeforeDays: z.number().int().min(0).default(0),
    classCode: z.string().max(20).optional(),

    isRealTimeBooking: z.boolean().default(false),
    airlinePnr: z.string().optional(),
    classDescription: z.enum(FARE_CLASS_DESCRIPTION).optional(),

    segments: z.array(SegmentSchema).min(1).max(8),

    fare: FareSchema,
    baggage: BaggageSchema.optional(),

    bucketPricing: z.array(BucketPricingItemSchema).optional().default([]),

    supplierId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    policyId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    fareRuleId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),

    status: z.enum(INVENTORY_STATUS).default('DRAFT'),
  })
  .refine((d) => d.seriesEndDate >= d.seriesStartDate, {
    message: 'seriesEndDate must be on or after seriesStartDate',
    path: ['seriesEndDate'],
  })
  .refine((d) => d.seatsPerDay <= d.totalSeats, {
    message: 'seatsPerDay cannot exceed totalSeats',
    path: ['seatsPerDay'],
  });
export type CreateInventoryRequest = z.infer<typeof CreateInventoryRequestSchema>;

export const UpdateInventoryRequestSchema = z.object({
  inventoryName: z.string().min(2).max(120).optional(),
  status: z.enum(INVENTORY_STATUS).optional(),
  closeBeforeDays: z.number().int().min(0).optional(),
  fare: FareSchema.partial().optional(),
  bucketPricing: z.array(BucketPricingItemSchema).optional(),
  policyId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  fareRuleId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  supplierId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  totalSeats: z.number().int().min(1).optional(),
  seatsPerDay: z.number().int().min(1).optional(),
});
export type UpdateInventoryRequest = z.infer<typeof UpdateInventoryRequestSchema>;

export const PublicInventorySchema = z.object({
  id: z.string(),
  inventoryCode: z.string(),
  inventoryName: z.string(),
  status: z.enum(INVENTORY_STATUS),
  travelType: z.enum(TRAVEL_TYPE),
  travelClass: z.enum(TRAVEL_CLASS),
  origin: z.object({
    code: z.string(),
    name: z.string().nullable(),
    country: z.string().nullable(),
  }),
  destination: z.object({
    code: z.string(),
    name: z.string().nullable(),
    country: z.string().nullable(),
  }),
  seriesStartDate: z.string().datetime(),
  seriesEndDate: z.string().datetime(),
  daysOfOperation: z.array(z.number()),
  totalSeats: z.number(),
  seatsPerDay: z.number(),
  seatsRemaining: z.number(),
  closeBeforeDays: z.number(),
  isRealTimeBooking: z.boolean(),
  segments: z.array(SegmentSchema),
  fare: FareSchema,
  baggage: BaggageSchema.nullable(),
  bucketPricing: z.array(BucketPricingItemSchema),
  supplierId: z.string().nullable(),
  policyId: z.string().nullable(),
  fareRuleId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicInventory = z.infer<typeof PublicInventorySchema>;

export const InventoryCalendarQuerySchema = z.object({
  origin: z.string().length(3).optional(),
  destination: z.string().length(3).optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type InventoryCalendarQuery = z.infer<typeof InventoryCalendarQuerySchema>;

export const InventoryCalendarDaySchema = z.object({
  date: z.string(),
  inventories: z.array(
    z.object({
      id: z.string(),
      inventoryCode: z.string(),
      inventoryName: z.string(),
      status: z.enum(INVENTORY_STATUS),
      seatsRemaining: z.number(),
      seatsPerDay: z.number(),
      adultFarePaise: z.number(),
      origin: z.string(),
      destination: z.string(),
    }),
  ),
});
export type InventoryCalendarDay = z.infer<typeof InventoryCalendarDaySchema>;

// Pax-type list reused in markup conditions
export const PAX_TYPES_AS_LIST = PAX_TYPE;
