# Draft email to Kafila account manager

**Subject:** TripBng × Kafila Air API — cancel + retrieveBooking spec request

---

Hello [Account Manager Name],

Quick update on the TripBng integration and one focused ask before we can
ship the full booking lifecycle to production.

**What's live in our staging today (validated end-to-end against your
endpoints):**

- `Auth_Header` builder with rolling `Request_Id`
- `Air_Search`
- `Air_FareRule`
- `Air_Reprice`
- `CreatePnr` (hold) — successfully creating GPnr values on staging
- `Air_Ticketing` (issue) — ticket numbers + PNRs come back cleanly
- `retriveBooking` — we consume `BookingInfo.GPnr`, `.PNR`, `.APnr`,
  `.CurrentStatus`

Outstanding work that's blocked on specs from your team:

---

## P0 — required before production cutover

### 1. Cancellation endpoint

We don't have the `cancel` spec yet. Please share:

- **Endpoint path** under the same base host as `CreatePnr`
- **Request body** — does it take the booking-ref alone (`GPnr`?), or
  also the original journey-key / search session / company-id?
- **Reason / penalty fields** — do we pass a cancellation reason code,
  refund-bucket selector, or PCC reference?
- **Response shape** — synchronous final state, or asynchronous "cancel
  queued" with a polling status (à la TBO Air/SendChangeRequest)?
- **Idempotency** — if we re-issue cancel on an already-cancelled `GPnr`,
  does Kafila no-op and return the prior result, or 400?
- **Refund + penalty** — does the response include refund amount and
  cancellation fee, or do we rely on our fare-rule snapshot?

### 2. `retriveBooking` — complete response field map

We currently extract `GPnr`, `PNR`, `APnr`, `CurrentStatus`. We need:

- **Full list of `BookingInfo` fields** populated for a ticketed booking
- **Ticket numbers** — does the response include a per-pax ticket array,
  or do we have to rely on the original `Air_Ticketing` response? (If
  yes, we can retire our ticket-poll worker.)
- **Segment-level status** for multi-segment bookings
- **Last-modified timestamp** so we can detect supplier-side schedule
  changes on poll

### 3. `CurrentStatus` enum

Please share the complete list of values your API can return, with which
are terminal vs in-flight. Specifically:

- `TICKETED` / `CONFIRMED` / `ISSUED` — which is canonical?
- `PENDING` — does this guarantee an eventual TICKETED, or could it
  transition to `SUPPLIER_CANCELLED` / similar?
- Are there hard-failure states (`SUPPLIER_REJECTED`, `EXPIRED`, …)?
  Our `KAFILA_TICKET_POLL` worker today keeps re-polling anything not in
  the success set. A closed list lets us stop polling on terminal
  failures.

---

## P1 — needed within 4 weeks of cutover

4. **Rate limits** — calls/sec/account, calls/day, separate caps for
   `Air_Search` vs the booking endpoints.
5. **Production endpoint URL** + IP whitelisting process.
6. **Webhooks / callbacks** for supplier-initiated changes — airline
   schedule changes, cancellations, ticket-reissue events.
7. **Complete error-code dictionary** with human descriptions and
   retryability hints.
8. **Sandbox refresh policy** + suggested test PNRs for end-to-end QA.

---

## What we have working today

For context — our integration uses:

- Per-session Kafila search sessions stored against an opaque
  `searchId`; tokens prefixed `kfl:` so callers can't accidentally use
  a different supplier's token
- Multi-fare result parsing (one option per `Journey × Fare` tuple)
- Auth-header builder injects a fresh UUID v4 `Request_Id` per call
- Circuit breaker + 18s timeout per call
- Async ticket-poll worker (`KAFILA_TICKET_POLL` queue) with exponential
  backoff up to 6 attempts (~53 min horizon) for any `CreatePnr` reply
  whose ticket array is empty
- All credentials in environment variables; never logged, never reach
  the frontend

Everything sits behind a `KAFILA_ENABLED` feature flag, off by default
until production whitelist + cancel spec land.

---

## Timeline

We'd like to ship cancellation by **end of next month**. That gives us:

- Week 1 — receive cancel + retrieveBooking spec
- Week 2 — wire + UAT against your staging
- Week 3 — production cutover with a pilot agency

Anything you can share sooner accelerates that. Happy to jump on a call
if it'd be faster than email.

Thanks for the support.

Best,
[Your Name]
[Title]
TripBng
[Phone] · [Email]
