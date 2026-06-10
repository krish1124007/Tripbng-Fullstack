import type { Role } from './enums.js';

// Permission strings are 'resource:action' or 'resource:action:scope'.
// Each permission lists the roles that have it by default.
// User-level customPermissions / deniedPermissions can override at runtime.
export const PERMISSIONS = {
  // User management
  'user:create': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'user:read': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],
  'user:update': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'user:delete': ['SUPER_ADMIN'],
  'user:simulate': ['SUPER_ADMIN'],

  // Inventory
  'inventory:create': ['SUPER_ADMIN'],
  'inventory:read': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY', 'SUB_AGENT'],
  'inventory:update': ['SUPER_ADMIN'],
  'inventory:hold': ['AGENCY', 'SUB_AGENT'],
  'inventory:book': ['AGENCY', 'SUB_AGENT'],

  // Markup
  'markup:platform': ['SUPER_ADMIN'],
  'markup:distributor': ['DISTRIBUTOR'],
  'markup:agency': ['AGENCY'],

  // Bookings
  //
  // SUPER_ADMIN is included on create/cancel for two reasons:
  //   1. Internal demo + sandbox bookings — the team needs to drive
  //      the full flight booking flow end-to-end from a platform-
  //      admin account during dev / QA / customer demos.
  //   2. Support escalations — admins occasionally need to cancel or
  //      re-create a booking on behalf of an agency that can't reach
  //      the portal (rare but real).
  'booking:create': ['SUPER_ADMIN', 'AGENCY', 'SUB_AGENT'],
  'booking:read:all': ['SUPER_ADMIN', 'ACCOUNTS_USER', 'SUPPORT_AGENT'],
  'booking:read:downline': ['DISTRIBUTOR'],
  'booking:read:own': ['SUPER_ADMIN', 'AGENCY', 'SUB_AGENT'],
  'booking:cancel': ['SUPER_ADMIN', 'AGENCY', 'SUB_AGENT', 'SUPPORT_AGENT'],
  'booking:download': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY', 'SUB_AGENT', 'SUPPORT_AGENT'],
  /** Manager-level approve/reject of corporate-policy-flagged bookings.
   *  Granted to AGENCY (owner) by default; sub-agent escalates to its own
   *  agency owner. */
  'booking:approve': ['SUPER_ADMIN', 'AGENCY', 'DISTRIBUTOR'],
  /** Manual wallet credit for a booking — admin override outside the
   *  auto-refund (cancel / ticket-failure) path. Limited to platform
   *  admins + accounts users; agencies cannot refund themselves. */
  'booking:refund:manual': ['SUPER_ADMIN', 'ACCOUNTS_USER'],
  /** Finalize a PENDING_MANUAL booking (Phase 5) — supplier PNR + ref +
   *  ticket numbers are filled in by ops after they issue manually, then
   *  this transitions the booking to TICKETED. Wallet was already
   *  debited at confirm-time so this is a metadata-only write. */
  'booking:issue-manual': ['SUPER_ADMIN', 'ACCOUNTS_USER', 'SUPPORT_AGENT'],

  // Search
  'search:flights': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  'search:buses': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],

  // Travel approvals (corporate workflow — Phase 5).
  /** Submit an approval request on the calling employee's own behalf,
   *  or via travel-desk admin permission. */
  'travel-approval:submit': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  /** Read own approval requests (employee-side inbox). */
  'travel-approval:read:own': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  /** Read the manager pending queue. */
  'travel-approval:read:pending': ['AGENCY', 'SUPER_ADMIN'],
  /** Approve / reject pending requests. */
  'travel-approval:decide': ['AGENCY', 'SUPER_ADMIN'],

  // Bus bookings (Phase 6).
  /** Create a bus booking against an approved request. */
  'bus-booking:create': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  /** Read bus bookings (own / agency-scoped via service layer). */
  'bus-booking:read': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  /** Cancel a bus booking (full or partial). */
  'bus-booking:cancel': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],

  // GST profile admin (Phase 8). Bookings attach a profile by id.
  'gst-profile:read': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  'gst-profile:write': ['AGENCY', 'SUPER_ADMIN'],

  // Saved-passenger directory — per-agency address book used by the
  // booking form's "Search saved passengers" autofill. Read + write
  // are split: every booking-creator should be able to autofill, but
  // adding/removing entries should be SUB_AGENT+ to prevent stray
  // pollution from temp users.
  'saved-passenger:read': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],
  'saved-passenger:write': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],

  // Invoice retrieval — JSON or PDF download.
  'bus-invoice:read': ['AGENCY', 'SUB_AGENT', 'SUPER_ADMIN'],

  // Bus reporting + analytics dashboards (Phase 9).
  'bus-reports:read': ['AGENCY', 'SUPER_ADMIN'],
  /** Audit-log viewer scoped to bus resources. The existing
   *  `audit:read` permission is SUPER_ADMIN-only; bus-audit:read
   *  lets agency owners see their own tenant scope (filtered by
   *  the service layer). */
  'bus-audit:read': ['AGENCY', 'SUPER_ADMIN'],

  // Distributor cockpit
  'distributor:cockpit:read': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'distributor:earnings:read': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'distributor:nudge': ['SUPER_ADMIN', 'DISTRIBUTOR'],

  // Wallet
  'wallet:topup:approve': ['SUPER_ADMIN', 'ACCOUNTS_USER'],
  'wallet:topup:reject': ['SUPER_ADMIN', 'ACCOUNTS_USER'],
  'wallet:topup:request': ['DISTRIBUTOR', 'AGENCY', 'SUB_AGENT'],
  'wallet:topup:read:all': ['SUPER_ADMIN', 'ACCOUNTS_USER'],
  'wallet:topup:read:downline': ['DISTRIBUTOR'],
  'wallet:topup:read:own': ['AGENCY', 'SUB_AGENT', 'DISTRIBUTOR'],
  'wallet:transfer:to-agency': ['DISTRIBUTOR'],
  'wallet:adjust': ['SUPER_ADMIN', 'ACCOUNTS_USER'],
  'wallet:credit-limit:set': ['SUPER_ADMIN'],
  'wallet:statement:download': [
    'SUPER_ADMIN',
    'DISTRIBUTOR',
    'AGENCY',
    'SUB_AGENT',
    'ACCOUNTS_USER',
  ],
  'wallet:read:all': ['SUPER_ADMIN', 'ACCOUNTS_USER'],
  'wallet:read:downline': ['DISTRIBUTOR'],
  'wallet:read:own': ['AGENCY', 'SUB_AGENT', 'DISTRIBUTOR'],

  // Distributor management
  'distributor:create': ['SUPER_ADMIN'],
  'distributor:read': ['SUPER_ADMIN'],
  'distributor:update': ['SUPER_ADMIN'],

  // Agency management
  'agency:create': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'agency:read:all': ['SUPER_ADMIN'],
  'agency:read:downline': ['DISTRIBUTOR'],
  'agency:read:own': ['AGENCY'],
  'agency:update': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'agency:credit:set': ['SUPER_ADMIN'],

  // Reports
  'report:platform': ['SUPER_ADMIN'],
  'report:downline': ['DISTRIBUTOR'],
  'report:own': ['AGENCY'],

  // Audit
  'audit:read': ['SUPER_ADMIN'],

  // Suppliers
  'supplier:create': ['SUPER_ADMIN'],
  'supplier:read': ['SUPER_ADMIN'],
  'supplier:update': ['SUPER_ADMIN'],
  'supplier:delete': ['SUPER_ADMIN'],
  'supplier:test': ['SUPER_ADMIN'],

  // User actions
  'user:suspend': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'user:activate': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'user:reset-password': ['SUPER_ADMIN', 'DISTRIBUTOR'],

  // Markup rules
  'markup-rule:create': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],
  'markup-rule:read': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],
  'markup-rule:update': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],
  'markup-rule:delete': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],

  // Fare rules
  'fare-rule:create': ['SUPER_ADMIN'],
  'fare-rule:read': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],
  'fare-rule:update': ['SUPER_ADMIN'],
  'fare-rule:delete': ['SUPER_ADMIN'],

  // Policies
  'policy:create': ['SUPER_ADMIN'],
  'policy:read': ['SUPER_ADMIN'],
  'policy:update': ['SUPER_ADMIN'],
  'policy:delete': ['SUPER_ADMIN'],

  // Agency groups
  'agency-group:create': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'agency-group:read': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'agency-group:update': ['SUPER_ADMIN', 'DISTRIBUTOR'],
  'agency-group:delete': ['SUPER_ADMIN', 'DISTRIBUTOR'],

  // Notifications
  'notification:read:own': [
    'SUPER_ADMIN',
    'DISTRIBUTOR',
    'AGENCY',
    'SUB_AGENT',
    'ACCOUNTS_USER',
    'SUPPORT_AGENT',
  ],

  // Banners
  'banner:create': ['SUPER_ADMIN'],
  'banner:read': [
    'SUPER_ADMIN',
    'DISTRIBUTOR',
    'AGENCY',
    'SUB_AGENT',
    'ACCOUNTS_USER',
    'SUPPORT_AGENT',
  ],
  'banner:update': ['SUPER_ADMIN'],
  'banner:delete': ['SUPER_ADMIN'],

  // What's-new updates (UpdatesFeed on the agency dashboard).
  'update:create': ['SUPER_ADMIN'],
  'update:read': [
    'SUPER_ADMIN',
    'DISTRIBUTOR',
    'AGENCY',
    'SUB_AGENT',
    'ACCOUNTS_USER',
    'SUPPORT_AGENT',
  ],
  'update:update': ['SUPER_ADMIN'],
  'update:delete': ['SUPER_ADMIN'],

  // Per-tenant branding — agency / distributor logo + colour theme.
  // Owners (AGENCY/DISTRIBUTOR) manage their own; SUPER_ADMIN can
  // override on behalf of any subject from the admin panel.
  'branding:read:own': ['AGENCY', 'SUB_AGENT', 'DISTRIBUTOR'],
  'branding:update:own': ['AGENCY', 'DISTRIBUTOR'],
  'branding:admin': ['SUPER_ADMIN'],

  // Incentives
  'incentive:create': ['SUPER_ADMIN'],
  'incentive:read': ['SUPER_ADMIN', 'DISTRIBUTOR', 'AGENCY'],
  'incentive:update': ['SUPER_ADMIN'],
  'incentive:delete': ['SUPER_ADMIN'],

  // Amendments
  'amendment:create': ['AGENCY', 'SUB_AGENT'],
  'amendment:read:own': ['AGENCY', 'SUB_AGENT'],
  'amendment:read:all': ['SUPER_ADMIN', 'SUPPORT_AGENT', 'ACCOUNTS_USER'],
  'amendment:approve': ['SUPER_ADMIN', 'SUPPORT_AGENT', 'ACCOUNTS_USER'],
  'amendment:reject': ['SUPER_ADMIN', 'SUPPORT_AGENT', 'ACCOUNTS_USER'],

  // Reports
  'report:run': ['SUPER_ADMIN', 'ACCOUNTS_USER', 'DISTRIBUTOR', 'AGENCY'],

  // Holiday & Visa product authoring (admin-side; the b2c spec calls these
  // 'ops_lead' / 'content' — we tie them to SUPER_ADMIN by default and allow
  // per-user customPermissions to extend later).
  'holiday:author': ['SUPER_ADMIN'],
  'visa:author': ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function getDefaultPermissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
    (PERMISSIONS[p] as readonly Role[]).includes(role),
  );
}

export function hasPermission(
  role: Role,
  permission: Permission,
  customPermissions: readonly string[] = [],
  deniedPermissions: readonly string[] = [],
): boolean {
  if (deniedPermissions.includes(permission)) return false;
  if (customPermissions.includes(permission)) return true;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
