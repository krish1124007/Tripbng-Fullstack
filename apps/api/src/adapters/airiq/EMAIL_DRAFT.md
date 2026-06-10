# Draft email to AirIQ — gagansareen@airiq.in

**Subject:** TripBng × AirIQ AAS — booking + ticket + retrieve + cancel spec requests

---

Hello Gagan,

Quick update on the TripBng integration. We have `/Availability` live and
returning fare options against your staging — token lifecycle (`/Login`,
auto-refresh on documented timeout marker, force-refresh on `Token timed
out` errors) is all working cleanly.

To complete the booking flow we need a handful of specs that aren't in
the v1.0 PDF you sent earlier:

---

## P0 — booking flow (blocking production cutover)

### 1. `/Pricing` + `/Book`

The v1.0 doc lists the URLs but stops short of full sample request
bodies. We need:

- **Full request schema for `/Pricing`** — required fields, where
  `Availability.TrackId` plugs in, how the fare we want to book is
  identified (`Fare.RPH`? `FareKey`? something else?)
- **Full request schema for `/Book`** — pax shape (titles, DOBs,
  passport fields for INT fares), contact details, GST hook
  if applicable for India bookings
- **`TrackId` semantics** — do we reuse the search `TrackId` across
  Pricing + Book, or does each endpoint mint a fresh one in its response?
- **Idempotency on `/Book`** — if our network hiccups mid-call, is a
  retry with the same payload safe (returns prior booking) or
  unsafe (creates a duplicate)?

### 2. `/IssueTicket`

The v1.0 doc says `ResultCode=2` means "still processing — poll back".
We need:

- **Poll endpoint** — same `/IssueTicket` URL with the booking-ref, or
  a separate `/TicketStatus` path?
- **Poll interval guidance** — recommended cadence + max-attempt cap
- **Result-code mapping**:
  - What flips `ResultCode` to "issued" (`1`?)
  - What signals hard failure (`0`? negative codes?)
  - Is there a `ResultMessage` / `ErrorDesc` field for human-readable
    detail when the issue fails?
- **Idempotency on issue** — re-issuing against an already-ticketed
  booking: no-op + return the prior ticket, or 4xx?

### 3. Cancel — does AirIQ support API-driven cancel?

The v1.0 doc has no `/Cancel` endpoint. Please confirm one of:

- **Yes, cancellation is via API** — please share the endpoint, request
  body, response shape, refund/penalty semantics (synchronous final or
  async-with-poll)
- **No, cancellation is offline-only** — handled via your support team
  with email + booking ref. If so, we'll route AirIQ bookings to manual
  cancellation in our ops queue. We just need this confirmed in writing
  so we can document the operational path for our agents.

### 4. `/RetrieveBooking`

Full request + response schema. Specifically we need to consume:

- Supplier PNR + airline PNR (distinct fields if applicable)
- Ticket numbers (per pax)
- Segment-level status (CONFIRMED / SCHEDULE_CHANGED / CANCELLED, …)
- Last-modified timestamp so polling detects supplier-side changes
- Pricing snapshot — the booking-time fare + any taxes/fees breakdown

---

## P1 — operational + compliance

### 5. Result-code dictionary

The v1.0 PDF doesn't include a numeric error/result-code dictionary.
For each endpoint (`/Login`, `/Availability`, `/Pricing`, `/Book`,
`/IssueTicket`, `/RetrieveBooking`, and cancel if applicable) please
share:

- Every code value
- A human description
- Whether it's retryable as-is, requires a re-search, or is terminal
- Distinct codes for: session expired vs auth failure vs availability
  gone vs price changed vs supplier timeout

### 6. Rate limits

Calls per second / per day, separate caps for `/Availability` vs the
booking endpoints, per-account vs per-IP.

### 7. Production endpoint URL + IP whitelisting

Staging accepts our calls — we assume production is gated. Our
production egress IP will come from our hosting provider once finalised;
let us know your whitelisting process.

### 8. GST + TDS fields

Our agencies are India-based corporate travel platforms; GSTIN-tagged
invoicing for input tax credit is mandatory. Please share:

- Where to pass GSTIN + company name + address in `/Book`
- Whether your response includes a GST breakdown (CGST/SGST/IGST split,
  HSN code) for our invoicing
- Any TDS-related fields we should be aware of in fare details

### 9. Webhooks / callbacks (nice-to-have)

If AirIQ pushes notifications for airline-initiated cancellations,
schedule changes, or fare reissues, we'd like to subscribe. If not, we
can poll `/RetrieveBooking` for upcoming bookings — but push is our
preference operationally.

---

## Where we are today

Adapter status (`apps/api/src/adapters/airiq/airiq.adapter.ts`):

- ✓ `/Login` + token cache + auto-refresh on documented timeout marker
- ✓ `/Availability` — full request mapper, multi-fare result parsing,
  `Itineraries[].Fares[] → NormalizedFareOption` per (itinerary × fare)
- ✗ `/Pricing`, `/Book`, `/IssueTicket`, `/RetrieveBooking`, cancel —
  all throwing `not yet implemented in this phase` until specs land
- Circuit breaker + 18s timeout per call
- Everything behind `AIRIQ_ENABLED` flag, off until production whitelist
  + the specs above are confirmed

---

## Timeline

We'd like to have AirIQ-backed bookings live within **4 weeks**:

- Week 1 — receive P0 specs, wire Pricing → Book → IssueTicket
- Week 2 — wire RetrieveBooking + cancel (or document the offline path)
- Week 3 — UAT against your staging with a pilot agency
- Week 4 — production cutover

Happy to schedule a call if it'd be faster than email — even a 30 min
walkthrough of the booking flow would unblock most of this.

Thanks for the support.

Best,
[Your Name]
[Title]
TripBng
[Phone] · [Email]
