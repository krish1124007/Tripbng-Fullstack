import { Router, type Router as RouterT } from 'express';
import { authRouter } from './auth.routes.js';
import { userRouter } from './user.routes.js';
import { agencyRouter } from './agency.routes.js';
import { distributorRouter } from './distributor.routes.js';
import { supplierRouter } from './supplier.routes.js';
import { auditRouter } from './audit.routes.js';
import { inventoryRouter } from './inventory.routes.js';
import { markupRuleRouter } from './markup-rule.routes.js';
import { fareRuleRouter } from './fare-rule.routes.js';
import { policyRouter } from './policy.routes.js';
import { mapPolicyRouter } from './map-policy.routes.js';
import { agencyGroupRouter } from './agency-group.routes.js';
import { walletRouter } from './wallet.routes.js';
import { agencyCreditRouter } from './agency-credit.routes.js';
import { searchRouter, airportRouter } from './search.routes.js';
import { busRouter } from './bus.routes.js';
import { bookingRouter } from './booking.routes.js';
import { distributorCockpitRouter } from './distributor-cockpit.routes.js';
import { notificationRouter } from './notification.routes.js';
import { bannerRouter } from './banner.routes.js';
import { updateRouter } from './update.routes.js';
import { brandingRouter } from './branding.routes.js';
import { adminBrandingRouter } from './admin-branding.routes.js';
import { incentiveRouter } from './incentive.routes.js';
import { amendmentRouter } from './amendment.routes.js';
import { reportRouter } from './reports.routes.js';
import { dataSubjectRouter } from './data-subject.routes.js';
import { productsRouter } from './products.routes.js';
import { adminHolidaysRouter } from './admin-holidays.routes.js';
import { adminVisaRouter } from './admin-visa.routes.js';
import { insuranceRouter } from './insurance.routes.js';
import { paymentsRouter } from './payments.routes.js';
import { openapiRouter } from './openapi.routes.js';
import { adminTboRouter } from './admin-tbo.routes.js';
import { hotelsRouter } from './hotels.routes.js';
import { hotelApprovalsRouter } from './hotel-approvals.routes.js';
import { providersRouter } from './providers.routes.js';
import { inquiriesRouter } from './inquiries.routes.js';
import { registrationsRouter } from './registrations.routes.js';
import { adminRegistrationsRouter } from './admin-registrations.routes.js';
import { savedPassengerRouter } from './saved-passenger.routes.js';
import { internalRouter } from './internal.routes.js';
import { adminAgencyRouter } from './admin-agency.routes.js';
import { adminHealthRouter } from './admin-health.routes.js';

export const apiRouter: RouterT = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/agencies', agencyRouter);
apiRouter.use('/agencies/:id', agencyCreditRouter);
apiRouter.use('/distributors', distributorRouter);
apiRouter.use('/distributors/:id', distributorCockpitRouter);
apiRouter.use('/suppliers', supplierRouter);
apiRouter.use('/audit-logs', auditRouter);
apiRouter.use('/inventories', inventoryRouter);
apiRouter.use('/markup-rules', markupRuleRouter);
apiRouter.use('/fare-rules', fareRuleRouter);
apiRouter.use('/policies', policyRouter);
apiRouter.use('/map-policies', mapPolicyRouter);
apiRouter.use('/agency-groups', agencyGroupRouter);
apiRouter.use('/wallet', walletRouter);
// /internal/* — booking engine ↔ wallet service-to-service endpoints.
// Auth via INTERNAL_API_KEY shared secret (see middleware/internal-auth.ts).
apiRouter.use('/internal', internalRouter);
// /admin/* — Phase-5 admin endpoints for the wallet/credit/DI/transfer
// surfaces from Phases 1-4. Requires SUPER_ADMIN role (enforced per-route).
apiRouter.use('/admin', adminAgencyRouter);

// /health/* — admin-only deep-health endpoints (SMTP probe + test-send).
// Distinct from the public healthRouter (liveness / readiness) — these
// expose sensitive operational detail and trigger side effects.
apiRouter.use('/health', adminHealthRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/airports', airportRouter);

// SeatSeller-backed bus module. Mounted BEFORE productsRouter so the
// real `/bus/*` surface shadows the legacy mock `/buses/search`. The
// older route stays alive for environments where SEATSELLER_ENABLED=false.
apiRouter.use('/bus', busRouter);
// Insurance — ASEGO B2B integration. Mounted BEFORE productsRouter so its
// /insurance/quote shadows the legacy mock placeholder in productsRouter.
apiRouter.use('/insurance', insuranceRouter);

// Payment gateways — ICICI Orange PG + PhonePe + manual top-ups + wallet ops.
// Webhook + return URLs sit BEFORE auth middleware (handled inside the router).
apiRouter.use('/payments', paymentsRouter);

// TBO-backed hotels API. Mounted BEFORE the legacy productsRouter so
// /hotels/* lands here first; productsRouter's mock /hotels/search stays
// alive for environments where TBO_ENABLED=false but is shadowed otherwise.
apiRouter.use('/hotels', hotelsRouter);

// Approval workflow for policy-flagged hotel bookings.
apiRouter.use('/hotel-approvals', hotelApprovalsRouter);

// ── Public-facing routes — MUST mount BEFORE the catch-all productsRouter
// at '/' below, otherwise its top-level `authenticate` middleware swallows
// these requests with a 401 before they reach our handlers.
//
// Partner inquiries — short-form expression-of-interest.
apiRouter.use('/inquiries', inquiriesRouter);
// Multi-step KYC sign-up (Aadhar / PAN / GST + verifications). Public
// because applicants don't have an account yet; rate-limited inside the
// router via loginLimiter.
apiRouter.use('/registrations', registrationsRouter);

// Per-agency saved-passenger directory — booking form's
// "Search saved passengers" autofill. Mounted BEFORE productsRouter
// so its top-level authenticate middleware doesn't shadow these
// authenticated routes.
apiRouter.use('/saved-passengers', savedPassengerRouter);

// Phase D — non-flight product modules. Mounts /buses/search,
// /holidays/search, /visa/quote (and the legacy mock /hotels/search) under
// one router for tidiness. Mounted at '/' with its own auth gate.
// Public reads for admin-authored holiday packages also live here:
//   GET /holidays/packages, GET /holidays/packages/:id
apiRouter.use('/', productsRouter);

// Admin CRUD for holiday packages. Sits under /admin/holidays so future
// admin surfaces (visa products, …) can mount alongside.
apiRouter.use('/admin/holidays', adminHolidaysRouter);

// Admin CRUD for visa products. Public reads live in productsRouter above.
apiRouter.use('/admin/visa', adminVisaRouter);

// TBO Holidays integration — admin sync triggers + token refresh.
apiRouter.use('/admin/tbo', adminTboRouter);

// Per-provider admin diagnostics — health probes, token refresh shims.
// Currently hosts Kafila V2 (Phase 1: /kafila/health).
apiRouter.use('/providers', providersRouter);

// Admin queue for /registrations submissions. SUPER_ADMIN-only; sits
// after productsRouter is fine because the admin router has its own
// authenticate + role middleware (which authenticate-after-authenticate
// is idempotent on req.auth).
apiRouter.use('/admin/registrations', adminRegistrationsRouter);
apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/banners', bannerRouter);
apiRouter.use('/updates', updateRouter);
apiRouter.use('/settings/branding', brandingRouter);
apiRouter.use('/admin/branding', adminBrandingRouter);
apiRouter.use('/incentives', incentiveRouter);
apiRouter.use('/amendments', amendmentRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/data-subject', dataSubjectRouter);

// OpenAPI 3.1 spec + Redoc-rendered docs page. Lives at /api/v1/openapi.json
// and /api/v1/docs — public so partners can browse without auth.
apiRouter.use('/', openapiRouter);
