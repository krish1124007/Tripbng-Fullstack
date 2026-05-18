# AirIQ Flight Adapter

Implementation of the `SupplierAdapter` contract for AirIQ Web Services
(AAS v1.0) — a B2B flight consolidator (WCF/.NET backend at `TravelAPI.svc`).

## Phase 1 status (search-only)

| Capability | Endpoint | Status |
|---|---|---|
| Login (token) | `/Login` | ✅ wired |
| Search | `/Availability` | ✅ wired |
| Fare rule | `/GetFareRule` | ❌ deferred to Phase 2 |
| Pricing | `/Pricing` | ❌ deferred to Phase 2 |
| Seat map | `/GetAvailSeatMap` | ❌ deferred to Phase 2 |
| Book / hold | `/Book` | ❌ deferred to Phase 2 |
| Ticket | `/IssueTicket` | ❌ deferred to Phase 2 |
| Retrieve | `/RetrieveBooking` | ❌ deferred to Phase 2 |
| Track status | `/TrackStatus` | ❌ deferred to Phase 2 (needed for `ResultCode=2` polling) |
| Balance | `/GetBalance` | ❌ deferred to Phase 2 |
| Cancel / refund | (not in v1.0 doc) | ❌ awaiting spec from `gagansareen@airiq.in` |

## How it slots in

```
flights/page.tsx
  └→ POST /api/v1/search/flights
       └→ services/search.service.ts → buildSearchAdapters() → fanoutSearch()
            ├→ SeriesAdapter   (always — our own contracted inventory)
            ├→ MockAdapter     (non-prod only)
            ├→ EtravAdapter    (only if ETRAV_ENABLED=true and ETRAV_* set)
            └→ AirIQAdapter    (only if AIRIQ_ENABLED=true and AIRIQ_* set)
```

`Promise.allSettled` — a slow or failing AirIQ doesn't block the rest of the
supplier set. Cheapest fare across all suppliers wins via the dedupe in
`search.service.ts`.

## Environment

```env
AIRIQ_ENABLED=true
AIRIQ_BASE_URL=http://testairiq.mywebcheck.in/TravelAPI.svc
AIRIQ_AGENT_ID=
AIRIQ_USERNAME=
AIRIQ_PASSWORD=
AIRIQ_APP_TYPE=API
AIRIQ_API_VERSION=V1.0
AIRIQ_HTTP_TIMEOUT_MS=30000
```

Test endpoint is plaintext HTTP. The production URL is "to be provided by mail"
per AirIQ — confirm HTTPS before passing PII over it.

## File map

| File | Purpose |
|---|---|
| `client.ts` | HTTP wrapper + custom Basic Auth header injection + envelope parsing |
| `auth.ts` | `AirIQTokenManager` — caches `/Login` token until 23:59:59 IST |
| `types.ts` | Hand-written DTOs matching the AAS v1.0 field names |
| `transforms.ts` | Pure mappers: pax counts, dates, `Itinerary × Fare → NormalizedFareOption` |
| `errors.ts` | Pattern-match `Status.Error` → `SupplierAdapterError` category |
| `utils.ts` | `buildAirIQAuthHeader`, `DateAdapter` (3 formats), `assertAirIQPax` |
| `airiq.adapter.ts` | The class registered with the supplier registry |

## Critical quirks baked in

These are non-obvious gotchas from the AAS v1.0 brief — handled at the layer
indicated, do not rediscover them in QA.

| Quirk | Handled by |
|---|---|
| `Authorization` is `Base64(AgentID*Username:Password)` (asterisk + colon, **not** RFC 7617) | `utils.ts → buildAirIQAuthHeader` |
| Token valid until 23:59:59 IST; auto-refresh on `"token was timed out"` reply | `auth.ts → AirIQTokenManager` + retry in `airiq.adapter.ts` |
| `FlightDate` is `yyyymmdd`; `DepartureDateTime` is `DD MMM YYYY HH:MM`; passport dates are `DD/MM/YYYY` | `utils.ts → DateAdapter` |
| Adult 1–9, Child 0–9, Adult+Child ≤ 9, Infant 0–4, Infant ≤ Adult | `utils.ts → assertAirIQPax` |
| Multi-city not supported — only `JourneyType: 'O' \| 'R'` | `transforms.ts → toJourneyType` rejects ≥3 segments |
| Every API call carries `SequenceID` — must be in support tickets | logged in `client.ts` |

## Open questions for AirIQ support (`gagansareen@airiq.in`, +91 99994 70665)

Send before Phase 2 booking work begins.

### Auth & connectivity
- Is the production URL HTTPS? (Critical — passport data cannot go over plaintext.)
- IP whitelisting required? Static IP needed for Vercel/AWS production egress?
- Rate limits per endpoint (calls/sec, calls/day)?

### Documentation gaps
- Sample JSON request/response payloads for every endpoint — the v1.0 doc
  references "sample JSON" but ships none.
- Cancellation / refund endpoint — not present in v1.0.
- `/TrackStatus` recommended polling interval.
- Webhooks for booking status changes (airline-initiated cancel, schedule change),
  or is polling the only option?

### Account configuration
- Which airlines are enabled on this account (LCC vs GDS matters for SSR / hold)?
- Test agent wallet balance and how to top up.
- Sandbox / test PNRs for E2E testing.
- Test cards (if applicable for /Book payment flow).

### Booking semantics (for Phase 2)
- SLA on `/Book` (P50/P99 latency, uptime).
- LCC vs GDS — does `/Book` auto-ticket for LCCs?
- `BlockPNR=true` hold duration for GDS bookings.
- GST input — exact field shape inside the request body.
- Indigo barcode data format (Annexure 14.1) — confirm PDF417 + Code128 format.
