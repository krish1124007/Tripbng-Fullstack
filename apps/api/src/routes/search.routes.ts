import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import { AppError, AirportSearchQuerySchema, SearchRequestSchema } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { searchAgencyLimit } from '../middleware/agency-rate-limit.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { searchAirports } from '../data/airports.js';
import { getCachedSearch, searchFlights } from '../services/search.service.js';
import {
  getEtravAdapterIfConfigured,
  getTboFlightAdapterIfConfigured,
} from '../adapters/registry.js';
import {
  mapTboFareQuoteForRoute,
  mapTboFareRulesForRoute,
  mapTboSSRForRoute,
} from '../adapters/tbo-flight/transforms.js';
import { buildMockSsrCatalog, buildSyntheticSsrCatalog } from '../adapters/mock-ssr.js';

export const searchRouter: RouterT = Router();

searchRouter.use(authenticate, requireAuth);

searchRouter.post(
  '/flights',
  searchAgencyLimit,
  requirePermission('search:flights'),
  validate(SearchRequestSchema),
  async (req, res, next) => {
    try {
      if (!req.auth!.agencyId && req.auth!.role !== 'SUPER_ADMIN') {
        throw new AppError('FORBIDDEN', { reason: 'no agency context' });
      }
      const out = await searchFlights(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          agencyId: req.auth!.agencyId ?? null,
          distributorId: req.auth!.distributorId,
        },
        req.body as ReturnType<typeof SearchRequestSchema.parse>,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

searchRouter.get('/flights/:searchId', async (req, res, next) => {
  try {
    const cached = await getCachedSearch(req.params.searchId);
    if (!cached) throw new AppError('NOT_FOUND', { reason: 'search expired' });
    return ok(res, cached);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/search/flights/farerule
 *
 * Fetch the supplier's HTML fare-rule blob for a result the user clicked.
 * Today this only supports the eTrav supplier (the existing Series + Mock
 * adapters carry their fare rules inline in the search response). Frontend
 * passes the SearchResult.fareToken + supplierCode; route routes to the
 * right adapter; UI renders the returned HTML in a sandboxed iframe.
 */
const FareRuleRequestSchema = z.object({
  supplierCode: z.string().min(1),
  fareToken: z.string().min(1),
});

/**
 * POST /api/v1/search/flights/reprice
 *
 * Revalidate fare + availability with the supplier just before booking.
 * Mandatory for eTrav (their docs explicitly require Reprice before
 * TempBooking). Returns:
 *   - the (possibly updated) total grossPaise so the UI can show a
 *     "Price updated" modal if it differs from search-time
 *   - Required_PAX_Details — boolean per-field, per-pax-type — which
 *     drives the dynamic passenger form
 *
 * For non-eTrav suppliers we synthesize a no-change response so the
 * frontend can call this uniformly regardless of supplier.
 */
const RepriceRequestSchema = z.object({
  supplierCode: z.string().min(1),
  fareToken: z.string().min(1),
  /** Original total at search time, in paise — for change detection. */
  originalTotalPaise: z.number().int().min(0).optional(),
  /** Customer mobile — eTrav requires this. Falls back to agency mobile. */
  customerMobile: z.string().min(8).max(15),
  gstInput: z.boolean().optional(),
});

interface RequiredPaxField {
  paxType: 'ADULT' | 'CHILD' | 'INFANT';
  required: string[];
  optional: string[];
  mandatorySsrs: string[] | null;
}

searchRouter.post(
  '/flights/farerule',
  requirePermission('search:flights'),
  validate(FareRuleRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof FareRuleRequestSchema.parse>;

      // Multi-supplier dispatch — each adapter exposes a fareRule method
      // outside the SupplierAdapter contract because the canonical contract
      // doesn't model HTML rule blobs (it would force every supplier to
      // implement an awkward stringly-typed return shape). Routes pick
      // the right adapter and map to a uniform response.
      if (body.supplierCode === 'ETRAV') {
        const etrav = getEtravAdapterIfConfigured();
        if (!etrav) {
          throw new AppError('NOT_FOUND', {
            reason: 'eTrav adapter not configured (set ETRAV_ENABLED=true)',
          });
        }
        const out = await etrav.fareRule(body.fareToken);
        return ok(res, {
          rules: out.FareRules.map((r) => ({
            segmentId: r.Segment_Id,
            name: r.FareRuleName,
            html: r.FareRuleDesc,
          })),
        });
      }

      if (body.supplierCode === 'TBO') {
        const tbo = getTboFlightAdapterIfConfigured();
        if (!tbo) {
          throw new AppError('NOT_FOUND', {
            reason: 'TBO flight adapter not configured (set TBO_ENABLED=true + creds + IP)',
          });
        }
        const rules = await tbo.fareRule(body.fareToken);
        return ok(res, { rules: mapTboFareRulesForRoute(rules) });
      }

      throw new AppError('VALIDATION_ERROR', {
        reason: `Fare rule lookup not supported for supplier ${body.supplierCode} — only ETRAV and TBO today`,
      });
    } catch (err) {
      next(err);
    }
  },
);

searchRouter.post(
  '/flights/reprice',
  requirePermission('search:flights'),
  validate(RepriceRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof RepriceRequestSchema.parse>;

      // TBO — real Air/FareQuote call. Same-shape response as eTrav so the
      // frontend's Pax-form rendering doesn't need to switch on supplier.
      if (body.supplierCode === 'TBO') {
        const tbo = getTboFlightAdapterIfConfigured();
        if (!tbo) {
          throw new AppError('NOT_FOUND', {
            reason: 'TBO flight adapter not configured (set TBO_ENABLED=true + creds + IP)',
          });
        }
        const result = await tbo.reprice(body.fareToken);
        return ok(res, mapTboFareQuoteForRoute(result, body.originalTotalPaise ?? null));
      }

      // Non-eTrav, non-TBO suppliers — synthesize a "no change" response so
      // the frontend can call this uniformly. Fields are based on Indian
      // flight booking conventions (always title/first/last; passport only
      // for international, but we don't know domain at this layer so safest
      // is to return passport optional).
      if (body.supplierCode !== 'ETRAV') {
        const defaultFields: RequiredPaxField[] = (['ADULT', 'CHILD', 'INFANT'] as const).map(
          (paxType) => ({
            paxType,
            required: ['title', 'firstName', 'lastName'],
            optional: ['dob', 'gender', 'passportNumber', 'passportExpiry', 'nationality'],
            mandatorySsrs: null,
          }),
        );
        return ok(res, {
          priceChanged: false,
          newTotalPaise: body.originalTotalPaise ?? null,
          requiredPaxDetails: defaultFields,
          frequentFlyerAccepted: false,
        });
      }

      const etrav = getEtravAdapterIfConfigured();
      if (!etrav) {
        throw new AppError('NOT_FOUND', {
          reason: 'eTrav adapter not configured (set ETRAV_ENABLED=true)',
        });
      }

      const out = await etrav.reprice({
        supplierFareTokens: [body.fareToken],
        customerMobile: body.customerMobile,
        gstInput: body.gstInput,
      });

      const entry = out.AirRepriceResponses[0];
      if (!entry) {
        throw new AppError('NOT_FOUND', { reason: 'eTrav returned no reprice entries' });
      }

      // Compute new total in paise. eTrav's FareDetails are per-pax-type — we
      // sum across all detail lines to get the grand total; pricing engine can
      // re-apply our own markup if needed downstream.
      const flight = entry.Flight;
      const fare = flight.Fares[0];
      let newTotalPaise = 0;
      if (fare) {
        for (const d of fare.FareDetails) {
          // d.Total_Amount is per-pax of that type; the upstream API returns
          // it as rupees (may be decimal). We convert to paise integer here.
          newTotalPaise += Math.round(d.Total_Amount * 100);
        }
      }

      const priceChanged =
        body.originalTotalPaise != null && Math.abs(newTotalPaise - body.originalTotalPaise) >= 100; // ignore <₹1 drift

      // Map eTrav's Required_PAX_Details (boolean-per-field) into a clean
      // required/optional split the frontend can render directly.
      const FIELD_MAP: Record<string, string> = {
        Title: 'title',
        First_Name: 'firstName',
        Last_Name: 'lastName',
        Gender: 'gender',
        Age: 'age',
        DOB: 'dob',
        Nationality: 'nationality',
        Passport_Number: 'passportNumber',
        Passport_Issuing_Country: 'passportIssuingCountry',
        Passport_Expiry: 'passportExpiry',
        DefenceServiceId: 'defenceServiceId',
        DefenceIssueDate: 'defenceIssueDate',
        DefenceExpiryDate: 'defenceExpiryDate',
        Student_Id: 'studentId',
      };
      const PAX_TYPE_MAP: Record<number, 'ADULT' | 'CHILD' | 'INFANT'> = {
        0: 'ADULT',
        1: 'CHILD',
        2: 'INFANT',
      };
      const requiredPaxDetails: RequiredPaxField[] = entry.Required_PAX_Details.map((p) => {
        const required: string[] = [];
        const optional: string[] = [];
        const asRecord = p as unknown as Record<string, unknown>;
        for (const [etravKey, ourKey] of Object.entries(FIELD_MAP)) {
          const v = asRecord[etravKey];
          if (v === true) required.push(ourKey);
          else if (v === false) optional.push(ourKey);
        }
        return {
          paxType: PAX_TYPE_MAP[p.Pax_type] ?? 'ADULT',
          required,
          optional,
          mandatorySsrs: p.Mandatory_SSRs ?? null,
        };
      });

      return ok(res, {
        priceChanged,
        newTotalPaise,
        requiredPaxDetails,
        frequentFlyerAccepted: out.FrequentFlyerAccepted,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/search/flights/ssr
 *
 * Fetch the SSR catalog (meals, baggage, seat map) for a chosen fare. Called
 * between FareQuote and Book/Ticket on the booking pathway.
 *
 * Currently TBO-only — eTrav's SSR specs haven't been built into its
 * adapter yet (Phase 1 status: SEARCH + HOLD wired; SSR pending). When
 * eTrav adds SSR, dispatch the same way `/farerule` and `/reprice` already do.
 */
const SsrRequestSchema = z.object({
  supplierCode: z.string().min(1),
  fareToken: z.string().min(1),
  /** Optional segments hint — used to synthesise an SSR catalog for
   *  suppliers we haven't fully integrated yet. The frontend passes
   *  these from its cached search result so the picker UI can be
   *  driven end-to-end. Ignored when supplierCode === 'TBO' (real
   *  catalog comes from the adapter). */
  segments: z
    .array(
      z.object({
        origin: z.string().length(3),
        destination: z.string().length(3),
      }),
    )
    .optional(),
});

searchRouter.post(
  '/flights/ssr',
  requirePermission('search:flights'),
  validate(SsrRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof SsrRequestSchema.parse>;

      if (body.supplierCode === 'TBO') {
        const tbo = getTboFlightAdapterIfConfigured();
        if (!tbo) {
          throw new AppError('NOT_FOUND', {
            reason: 'TBO flight adapter not configured (set TBO_ENABLED=true + creds + IP)',
          });
        }
        const envelope = await tbo.getSSR(body.fareToken);
        return ok(res, mapTboSSRForRoute(envelope));
      }

      // MOCK fares — parse origin/destination from the synthetic token.
      if (body.supplierCode === 'MOCK') {
        return ok(res, buildMockSsrCatalog(body.fareToken));
      }

      // Every other supplier (ETRAV / KAFILA / AIRIQ / …) — synthesise
      // a plausible catalog from the segments the frontend already
      // knows about. Keeps the BaggageDetailsPicker and
      // SeatSelectionPicker functional end-to-end while we wait for
      // each adapter's real SSR integration to land. When a real
      // adapter is added, drop into a branch above this fallback.
      if (body.segments && body.segments.length > 0) {
        return ok(res, buildSyntheticSsrCatalog(body.segments));
      }

      throw new AppError('VALIDATION_ERROR', {
        reason: `SSR lookup needs segments[] hint for supplier ${body.supplierCode}`,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Airport autocomplete — public to anyone authenticated.
export const airportRouter: RouterT = Router();
airportRouter.use(authenticate, requireAuth);
airportRouter.get('/', validate(AirportSearchQuerySchema, 'query'), (req, res) => {
  const { q, limit } = req.query as unknown as ReturnType<typeof AirportSearchQuerySchema.parse>;
  return ok(res, searchAirports(q, limit));
});
