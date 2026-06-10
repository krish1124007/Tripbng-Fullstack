# Draft email to TBO Holidays account manager

**Subject:** TripBng × TBO Holidays API — integration kickoff + spec request

---

Hello [Account Manager Name],

Quick context — TripBng's TBO Hotel API integration is live in our staging
environment (Search → BlockRoom → Book on `affiliate.tektravels.com/HotelAPI`,
authenticated against `Sharedapi.tektravels.com/SharedData.svc/rest`). We
mapped the request/response shapes against your Postman docs and the
integration has been stable since [date].

We're now ready to wire **TBO Holidays** — packaged-tour products distinct
from the standalone hotel API. We need a handful of specs before we can
build the adapter.

---

## P0 — required before staging integration

### 1. Base URL + credentials

- **Production + sandbox base URL** for the Holidays API.
- **Authentication scheme** — does it share the SharedData Authenticate
  flow used by the Hotel API (with the same `TokenAgencyId` /
  `TokenMemberId` pair), or is it a separate credential set?
- If separate: please issue staging credentials for our account.

### 2. Endpoint specifications

The endpoints we expect to integrate (please confirm names + share OpenAPI
or Postman collections):

- **Search** — packaged-holiday search by destination + duration + pax mix.
- **PackageDetail** — full itinerary + inclusions for a single result.
- **PreBook** / **GetQuote** — re-validate availability + final price.
- **Book** — commit reservation, return confirmation number.
- **GetBookingDetail** — fetch confirmation status + voucher URL.
- **SendChangeRequest** (or equivalent) — cancellation.
- **GetChangeRequestStatus** — async cancellation poll.

For each endpoint we'd like the full request body + response shape, with
sample payloads.

### 3. Pricing semantics

- Currency — INR throughout, or does international source-side pricing
  ride in USD / local currency with conversion?
- Tax inclusivity — does the quoted price already include GST, or do
  we apply Indian GST on top?
- Are markups applied by TBO at the API layer, or do we get the raw
  cost price?

### 4. Cancellation policy

- Per-package cancellation rules — how are they expressed in the API?
  Free-text, or structured penalty bands keyed to days-before-travel?
- Synchronous vs asynchronous cancellation — does the cancel call
  return a final state, or does it queue a change request we have to
  poll (mirrors the Hotel API's pattern)?
- Refund settlement window — when does the refund show up on our
  TBO wallet?

---

## P1 — needed within 4 weeks of go-live

5. **Status-change webhooks** — supplier-initiated cancellations,
   itinerary changes, hotel substitutions. If you push notifications,
   we'd like to subscribe; if not, we'll poll `GetBookingDetail`.
6. **Voucher PDF format** — sample voucher for any destination, so we
   can decide whether to forward the supplier voucher as-is or render
   our own from the structured response.
7. **Rate limits** — calls/sec/account, separate caps for Search vs
   booking endpoints, daily quotas.
8. **Error-code dictionary** — every code value, human description,
   retryability hint. Particularly the distinct codes for "session
   expired" vs "package no longer available" vs "price changed since
   search" vs "supplier inventory drained".

---

## What's already mapped from our Hotel API integration

For context — the patterns we've already implemented for TBO Hotels and
will reuse here:

- `Authenticate` + token cache + force-refresh on documented timeout
- `Request_Id` UUID v4 per call
- Circuit breaker + 18-second timeout per call
- All credentials in environment variables, never logged, never reach
  the frontend
- IP whitelisting via `TBO_END_USER_IP`

The Holidays adapter will sit behind a `TBO_HOLIDAYS_ENABLED` feature
flag, off by default, until production whitelist + the specs above are
confirmed.

---

## Timeline

We'd like TBO Holidays live within **6 weeks**:

- Week 1–2 — receive P0 specs, wire Search + PreBook against staging
- Week 3 — wire Book + GetBookingDetail + cancellation
- Week 4 — UAT against a pilot agency
- Week 5 — soft launch
- Week 6 — production cutover

Happy to schedule a call if it'd be faster than email.

Thanks for the support.

Best,
[Your Name]
[Title]
TripBng
[Phone] · [Email]
