# Phase D — Real holiday + visa supplier integrations

**Status as of 2026-05-21**: Same posture as Phase B. The audit identified
holidays + visa as mock-only and Phase D was scoped at "wire real suppliers".
After mapping the work, the remaining blockers are not engineering effort —
they're missing API specifications + production credentials from the
chosen suppliers.

This doc consolidates: what shipped in Phase D, what's outstanding per
supplier, and the consolidated ask per vendor.

---

## What HAS shipped in Phase D

**D.1 — `HolidaySupplierAdapter` full-lifecycle contract**
`apps/api/src/adapters/holiday/types.ts` defines the contract every
holiday supplier implements: `search`, `priceCheck`, `book`, `cancel`,
`fetchStatus`. Optional methods so partially-wired adapters type-check
without throw stubs everywhere. Closed `HolidaySupplierCode` enum
(`MOCK_HOLIDAYS` / `TBO_HOLIDAYS` / `CUSTOM`) discriminates booking
ownership.

**D.2 — `VisaSupplierAdapter` full-lifecycle contract**
`apps/api/src/adapters/visa/types.ts`: `quote`, `getDocumentRequirements`,
`submitApplication`, `uploadDocument`, `fetchStatus`, `cancel`. Supplier
codes reserved: `MOCK_VISA` / `VFS` / `BLS` / `ATLYS` / `EMBASSY` / `CUSTOM`.

**D.3 — Mock adapters extracted to dedicated provider directories**
`MockHolidayAdapter` and `MockVisaAdapter` moved out of the monolithic
`products.mock.ts` into `adapters/holiday/mock-holiday.adapter.ts` and
`adapters/visa/mock-visa.adapter.ts`. Both implement the full lifecycle —
synthetic-but-coherent data so the booking flow can be exercised
end-to-end without a real supplier. In-process state stores per adapter
keep `fetchStatus` + `cancel` returning consistent state during tests.

**D.4 — Supplier registries**
`adapters/holiday/registry.ts` and `adapters/visa/registry.ts` provide a
single resolution point (`holidaySupplier(code)` / `visaSupplier(code)`).
Booking flow consults these by `supplierCode` rather than referencing a
specific adapter class. Tests inject overrides via `_setHolidaySupplier`
/ `_setVisaSupplier`.

**D.5 — TBO Holidays + VFS Visa adapter skeletons**
Real adapters at `adapters/holiday/tbo-holidays.adapter.ts` and
`adapters/visa/vfs-visa.adapter.ts`. Both ship as SKELETONS — every
method throws `NOT_IMPLEMENTED` until specs land. Empty capability lists
let the booking flow detect "supplier configured but not yet capable" and
fall back / refuse cleanly.

**D.6 — Env config for both real suppliers**
`apps/api/src/config/env.ts`:
- `TBO_HOLIDAYS_ENABLED` / `TBO_HOLIDAYS_USERNAME` / `TBO_HOLIDAYS_PASSWORD` /
  `TBO_HOLIDAYS_BASE_URL`
- `VFS_VISA_ENABLED` / `VFS_API_KEY` / `VFS_API_SECRET` / `VFS_BASE_URL`

All default to OFF with placeholder URLs — production must override.

---

## What's outstanding (per supplier)

### TBO Holidays — owner: TBO account team

**Adapter state**: `apps/api/src/adapters/holiday/tbo-holidays.adapter.ts`
- ✗ search — needs TBO Holidays Search endpoint spec
- ✗ priceCheck — needs PreBook / GetQuote spec
- ✗ book — needs Book endpoint spec
- ✗ cancel — needs SendChangeRequest equivalent for holidays
- ✗ fetchStatus — needs GetBookingDetail spec

Full ask list at `apps/api/src/adapters/holiday/EMAIL_DRAFT.md`. P0
items:

1. Production + sandbox base URL
2. Authentication — shared with TBO Hotels or separate creds?
3. Endpoint schemas (Search / PackageDetail / PreBook / Book /
   GetBookingDetail / SendChangeRequest / GetChangeRequestStatus)
4. Pricing semantics — currency, tax inclusivity, markup model
5. Cancellation policy expression — free-text or structured penalty bands

### VFS Global — owner: VFS B2B Partnerships

**Adapter state**: `apps/api/src/adapters/visa/vfs-visa.adapter.ts`
- ✗ quote — needs VFS pricing API spec
- ✗ getDocumentRequirements — needs per-(country × purpose) checklist endpoint
- ✗ submitApplication — needs CreateApplication spec + portal URL semantics
- ✗ uploadDocument — needs multipart upload spec or signed-URL flow
- ✗ fetchStatus — needs GetApplicationStatus + state enum
- ✗ cancel — needs WithdrawApplication spec + refund computation

Full ask list at `apps/api/src/adapters/visa/EMAIL_DRAFT.md`. P0 items:

1. API base URL + authentication scheme + B2B account provisioning
2. Pricing endpoint — quote per (country × purpose × applicants)
3. CreateApplication endpoint + portal URL semantics (VFS hosts uploads
   or do we?)
4. Document checklist endpoint or static reference
5. Document upload pipeline — multipart REST or signed URL
6. Status polling endpoint + state enum + (optional) webhook channel
7. WithdrawApplication endpoint + refund tiers

### Alternative visa suppliers (BLS / Atlys / OneVasco)

Currently no contact made. Registry has the supplier codes reserved
(`BLS` / `ATLYS`) so booking docs can be tagged ahead of integration, but
calling them today throws `NOT_IMPLEMENTED` at the registry level.

If VFS is unavailable as a B2B partner, **Atlys** is the most B2B-friendly
alternative (they have a published API and have onboarded other Indian
travel platforms). Recommend opening a parallel conversation if VFS
discussions stall.

---

## Plan to unblock

1. **Send two vendor emails this week** using the drafts under
   `apps/api/src/adapters/{holiday,visa}/EMAIL_DRAFT.md`. The previous
   TBO Hotels relationship gives us a warm intro into TBO Holidays;
   VFS is cold.

2. **Score responses as they come back.** Holiday + visa are
   independent — we can ship one ahead of the other.

3. **Manual issuance is the safety net.** Phase 5's Map Source + manual
   issuance pipeline (and B.9's follow-up worker) means holiday + visa
   bookings can ride through ops-handled manual fulfilment until the
   API integrations land. The mock adapter shapes the user experience
   today; real suppliers swap in transparently because the contract is
   identical.

4. **Pilot countries first** for VFS. Don't try to onboard all countries
   at once — start with UAE eVisa (highest volume + simplest flow),
   prove the integration, then roll out Thailand / Singapore /
   Schengen one at a time.

Once specs land we'll re-open Phase D with concrete adapter PRs that
fill in the `NOT_IMPLEMENTED` method bodies. The contract + registry +
booking flow stay unchanged — only the wire calls inside the skeleton
classes need writing.

---

## How a new supplier plugs in (developer playbook)

When TBO Holidays specs arrive:

1. Implement the five methods on
   `apps/api/src/adapters/holiday/tbo-holidays.adapter.ts` against the
   TBO API client (build a `client.ts` alongside, mirror
   `apps/api/src/adapters/tbo/client.ts`).
2. Update `capabilities` from `[]` to the methods you've shipped — the
   booking flow consults this before dispatching.
3. Set `TBO_HOLIDAYS_ENABLED=true` in env + provision credentials.
4. Register one or more HolidayPackage documents with
   `supplierCode: 'TBO_HOLIDAYS'` — the booking flow now routes those
   through the new adapter.
5. Add adapter tests at `apps/api/tests/tbo-holidays.test.ts` covering
   search → priceCheck → book → cancel → fetchStatus on the staging
   sandbox.

Same playbook for VFS.

---

## Phase D won't fully complete until:

- [ ] TBO Holidays specs received
- [ ] TBO Holidays staging credentials provisioned
- [ ] TBO Holidays adapter — 5 methods wired
- [ ] VFS B2B specs received (or alternative supplier chosen)
- [ ] VFS staging credentials provisioned
- [ ] VFS adapter — 6 methods wired
- [ ] Pilot country (UAE) live in production with one agency
- [ ] HolidayBooking / VisaBooking flows updated to dispatch through
  the registry instead of hardcoding `supplier: 'MOCK'`

The first six are vendor-dependent and can't ship inside an engineering
sprint. The last item is engineering-only and can land independently
once a real adapter has at least `book` wired.
