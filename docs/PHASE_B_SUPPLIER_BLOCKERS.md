# Phase B — Flight adapter completion: supplier-spec blockers

**Status as of 2026-05-21**: Phase B was scoped at "complete the flight adapter
contract for the three non-TBO suppliers (Kafila / eTrav / AirIQ)". After a
walk through each adapter's source we found that the gaps are NOT engineering
work — they're missing API specs from the supplier account managers. This
doc consolidates exactly what's outstanding from each supplier so a single
follow-up email per vendor can unblock the work.

What HAS shipped in Phase B:

- **B.8** TBO LCC cancel pre-filter — synthetic `LCC:*` `supplierBookingRef`
  values now short-circuit to `supplierCancellationStatus = PROCESSED`
  instead of dispatching to TBO Air/SendChangeRequest (which would 400).
  `apps/api/src/services/booking.service.ts` ~line 880.

- **B.9** Manual-issuance follow-up worker — every-4h cron sweep that fires
  tiered ops alerts (`MANUAL_ISSUANCE_PENDING_REMINDER`) on bookings parked
  in `PENDING_MANUAL` past 4h / 12h / 24h / 48h. Files:
  - `apps/api/src/services/booking/manual-issuance-followup.service.ts`
  - `apps/api/src/queues/manual-issuance-followup.worker.ts`
  - `apps/api/src/services/alerts/templates/manual-issuance-pending-reminder.ts`

The remaining items B.1–B.7 are listed below grouped by supplier. Each is
labelled by what's blocking and where to look for adapter-side context.

---

## Kafila (B.1, B.2, B.3) — owner: Kafila account team

**Adapter state**: `apps/api/src/adapters/kafila/kafila.adapter.ts`
- ✓ search, fareRules, reprice, hold, ticket (with poll worker)
- ✗ cancel (`Phase 5: cancel (TODO)` comment at ~line 348)
- ✗ retrieveBooking — schema fields beyond `GPnr` / `PNR` / `CurrentStatus`
  are inferred from samples; needs the full response shape

### What we need

1. **Cancel endpoint specification**
   - URL path under the same base host as `CreatePnr` / `retriveBooking`
   - Request body shape — does it take the booking-ref alone (e.g. `GPnr`),
     or also the original session/journey-key? Does the supplier-side cancel
     need a reason code, refund-bucket selector, or PCC reference?
   - Response shape — synchronous success/fail, or asynchronous "cancel
     queued" with a polling status field (mirrors TBO Air/SendChangeRequest)?
   - Idempotency — if we re-issue the cancel with the same `GPnr`, does
     Kafila no-op the second call or 400?
   - Penalty / refund computation — does Kafila return the refund amount
     and cancellation fee, or do we rely on our fare-rule snapshot?

2. **`retriveBooking` response — full field map**
   - We currently consume `BookingInfo.GPnr`, `.PNR`, `.APnr`,
     `.CurrentStatus`. What other fields are populated for ticketed bookings
     (segment-level status, ticket numbers per pax, last-modified
     timestamp)? Specifically: does the response include the ticket-number
     array so we can drop the `KAFILA_TICKET_POLL` worker entirely?

3. **`CurrentStatus` enum**
   - Complete list of values and which are terminal vs in-flight. Today we
     treat anything not in `{TICKETED, CONFIRMED, ISSUED}` as still
     pending — the ticket-poll worker keeps re-polling. Closed list would
     let us stop polling on hard failures (e.g. SUPPLIER_CANCELLED).

---

## eTrav (B.4, B.5) — owner: eTrav account team

**Adapter state**: `apps/api/src/adapters/etrav/etrav.adapter.ts`
- ✓ search, fareRule, reprice, hold (TempBooking), ticket-Hold (Type=0)
- ✗ ticket-Issue (`Ticketing_Type=1` / `=2`) — gated on `AddPayment` spec
- ✗ cancel — `Air_Cancellation` spec pending
- ✗ retrieveBooking — `Air_History` spec pending

**An existing draft email is at** `apps/api/src/adapters/etrav/EMAIL_DRAFT.md`
and is already comprehensive. The asks are reproduced here as a tracking
list so we can mark each off as eTrav responds.

P0 (booking flow):
1. `AddPayment` request shape — `Amount` field name/format, currency,
   payment-mode field, idempotency semantics, success response
2. `Ticketing_Type` `1` vs `2` semantic difference

P1 (post-booking + ancillaries):
3. `Air_History` request/response — booking timeline + status retrieval
4. `Air_Cancellation` + `Air_GetCancelPenalty` — penalty preview + cancel
5. `Air_Reprint`, `Air_ReleasePNR`
6. SSR / seat-map endpoints (`Air_GetSSR`, `Air_GetSeatMap`,
   `Air_GetPostSSR` / `Air_InitiatePostSSR` / `Air_ConfirmPostSSR`)
7. Complete `Error_Code` dictionary + `Status_Id` enum

P2 (operational):
8. `GetBalance` host + endpoint
9. `GST_Input` request schema (India input tax credit)
10. `TDS` field semantics in `FareDetails`
11. Rate limits per endpoint
12. Webhooks for airline-initiated cancellation / schedule changes
13. Production endpoint URL + IP whitelisting process

---

## AirIQ (B.6, B.7) — owner: gagansareen@airiq.in

**Adapter state**: `apps/api/src/adapters/airiq/airiq.adapter.ts`
- ✓ search (`/Availability`) live, includes auto-token-refresh on timeout
- ✗ hold (`/Pricing` + `/Book`) — endpoints documented but flow needs
  confirmation
- ✗ ticket (`/IssueTicket`) — needs `ResultCode=2` polling story
- ✗ cancel — endpoint NOT in v1.0 doc; confirm whether AirIQ supports
  cancel at all, and if so, share the endpoint
- ✗ retrieveBooking (`/RetrieveBooking`) — needs spec confirmation

### What we need

1. **`/Pricing` + `/Book` request/response specs**
   - The v1.0 PDF lists the endpoint URLs but stops short of full sample
     request bodies. We need: required fields per endpoint, pax-shape
     for passport-mandated fares, GST hook, `Pricing.TrackId` vs
     `Availability.TrackId` relationship (do we reuse the search TrackId
     or does Pricing mint a fresh one?)
   - Idempotency on `/Book` — if our network hiccups mid-call, is a retry
     with the same body safe?

2. **`/IssueTicket` flow**
   - Async behaviour: the v1.0 doc says `ResultCode=2` means "still
     processing — poll back". Confirm the polling endpoint, polling
     interval, max-attempt guidance, and the field name that flips to
     `1` (success) or `0`/negative (failure)
   - Idempotency on issue — re-issuing against a ticketed booking: no-op
     and return the existing ticket, or 4xx?

3. **Cancel — does AirIQ support it via API?**
   - The v1.0 doc has no `/Cancel`. If cancellation is offline-only via
     account-manager email, we'll route AirIQ bookings to `PENDING_MANUAL`
     for ops handling. Confirm and we'll add the corresponding Map Source
     rule. If there IS an API path, share the spec.

4. **`/RetrieveBooking` response shape**
   - Specifically: does it return ticket numbers, segment status array,
     last-modified, supplier PNR + airline PNR distinctly? We need the
     same field map we use for Kafila to keep our normalised booking
     details consistent across suppliers.

5. **Error / result-code dictionary**
   - The v1.0 PDF doesn't ship a numeric dictionary. We need values +
     descriptions + retryability hints for each endpoint we'll wire.

---

## Plan to unblock

1. **Send three vendor emails this week** using the drafts above.
   For Kafila + AirIQ we still need to author drafts under their adapter
   directories (`apps/api/src/adapters/kafila/EMAIL_DRAFT.md` and
   `apps/api/src/adapters/airiq/EMAIL_DRAFT.md`) — the eTrav draft is the
   template.

2. **Score responses as they come back.** Each adapter is gated on a small
   number of specs; we can ship cancel-only for Kafila independently of
   eTrav's `AddPayment`, and route AirIQ bookings to manual issuance via
   Map Source if cancel-via-API never materialises.

3. **Manual issuance is the safety net.** Phase 5's Map Source + manual
   issuance pipeline (now reinforced by B.9's followup worker) means any
   supplier we can't fully wire still has a working booking path — ops
   takes over for the leg we can't automate.

Once the specs land we'll re-open Phase B with concrete adapter PRs.

---

## Manual-issuance follow-up worker (B.9) — operational notes

The follow-up worker (`manual-issuance-followup.worker.ts`) is armed at
`0 2,6,10,14,18,22 * * *` IST (every 4 hours). Per-(bookingId, tier) dedupe
in Redis means each escalation fires once:

| Tier            | Triggered at  | Dedupe TTL | Recipient        |
|-----------------|---------------|------------|------------------|
| REMINDER        | ≥ 4h pending  | 9h         | OPS_ALERT_EMAIL  |
| ESCALATION      | ≥ 12h pending | 13h        | OPS_ALERT_EMAIL  |
| CRITICAL        | ≥ 24h pending | 25h        | OPS_ALERT_EMAIL  |
| CRITICAL_HIGH   | ≥ 48h pending | 7 days     | OPS_ALERT_EMAIL  |

**Re-firing manually**: `redis-cli DEL manual-issuance-followup:fired:<bookingId>:<tier>`
then re-trigger the worker (or wait for the next cron tick).
