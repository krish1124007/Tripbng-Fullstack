import { z } from 'zod';

export const DistributorDashboardSummarySchema = z.object({
  distributorId: z.string(),
  distributorCode: z.string(),
  distributorName: z.string(),

  thisMonth: z.object({
    earningsPaise: z.number().int(),
    bookingCount: z.number().int(),
    grossGmvPaise: z.number().int(),
    activeAgencies: z.number().int(),
  }),
  lastMonth: z.object({
    earningsPaise: z.number().int(),
    bookingCount: z.number().int(),
    grossGmvPaise: z.number().int(),
  }),
  lifetime: z.object({
    earningsPaise: z.number().int(),
    bookingCount: z.number().int(),
    grossGmvPaise: z.number().int(),
  }),

  agencies: z.object({
    total: z.number().int(),
    active: z.number().int(),
    dormant: z.number().int(),
  }),

  walletBalancePaise: z.number().int(),
  overrideCommissionPercent: z.number(),

  trend: z.array(
    z.object({
      day: z.string(),
      earningsPaise: z.number().int(),
      bookingCount: z.number().int(),
    }),
  ),

  topAgencies: z.array(
    z.object({
      agencyId: z.string(),
      agencyCode: z.string(),
      companyName: z.string(),
      earningsPaise: z.number().int(),
      bookingCount: z.number().int(),
      grossGmvPaise: z.number().int(),
    }),
  ),
});
export type DistributorDashboardSummary = z.infer<typeof DistributorDashboardSummarySchema>;

export const EarningsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupBy: z.enum(['day', 'month', 'agency']).default('day'),
});
export type EarningsQuery = z.infer<typeof EarningsQuerySchema>;

export const EarningsRowSchema = z.object({
  // For groupBy=day: 'YYYY-MM-DD'. For month: 'YYYY-MM'. For agency: agencyId.
  key: z.string(),
  label: z.string(),
  earningsPaise: z.number().int(),
  bookingCount: z.number().int(),
  grossGmvPaise: z.number().int(),
  cancelledCount: z.number().int(),
});
export type EarningsRow = z.infer<typeof EarningsRowSchema>;

export const EarningsResponseSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  groupBy: z.enum(['day', 'month', 'agency']),
  rows: z.array(EarningsRowSchema),
  totals: z.object({
    earningsPaise: z.number().int(),
    bookingCount: z.number().int(),
    grossGmvPaise: z.number().int(),
    cancelledCount: z.number().int(),
  }),
});
export type EarningsResponse = z.infer<typeof EarningsResponseSchema>;

export const DormantAgencySchema = z.object({
  agencyId: z.string(),
  agencyCode: z.string(),
  companyName: z.string(),
  city: z.string(),
  walletBalancePaise: z.number().int(),
  lastBookingAt: z.string().datetime().nullable(),
  daysSinceLastBooking: z.number().int().nullable(),
  totalLifetimeBookings: z.number().int(),
  status: z.string(),
});
export type DormantAgency = z.infer<typeof DormantAgencySchema>;

export const DormantQuerySchema = z.object({
  // Cutoff in days — agencies with no TICKETED booking in the past `cutoffDays` are dormant.
  cutoffDays: z.coerce.number().int().min(7).max(365).default(30),
});

export const NudgeRequestSchema = z.object({
  agencyId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  channel: z.enum(['EMAIL', 'SMS', 'IN_APP']).default('IN_APP'),
  message: z.string().min(10).max(500).optional(),
});
export type NudgeRequest = z.infer<typeof NudgeRequestSchema>;
