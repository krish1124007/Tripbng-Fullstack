# Draft email to eTrav account manager

**Subject:** TripBng × eTrav AIR API — outstanding spec + connectivity questions

---

Hello [Account Manager Name],

Quick update + one focused ask.

**What's wired and live against staging today:**
- `Air_Search` ✓
- `Air_FareRule` ✓
- `Air_Reprice` ✓
- `Air_TempBooking` ✓ (discovered via probe — Booking_RefNo `F-A03MAY26X89JE` successfully created on staging; please confirm the request shape matches your spec)
- `Air_Ticketing` (Hold mode, `Ticketing_Type=0`) ✓ (also probe-discovered; "Hold Attempt" registered cleanly)

We had to discover the TempBooking + Ticketing request shapes empirically because we never received written specs for them. Our reverse-engineered contract is at the bottom of this email — please review and flag anything we got wrong.

**The one piece we need from you to ship the full booking flow:**

`AddPayment` (path `tradehost/TradeAPIService.svc/JSONService/AddPayment` — different host from the airline endpoints). We've confirmed the URL and that `RefNo` is the booking-id field. We need the rest of the request shape:

1. `Amount` field — name + format (decimal INR? integer paise? string?)
2. `Currency_Code` field — required? fixed to `"INR"`?
3. Any other mandatory fields (`PaymentMode`, `TransactionRef`, `RetailerId`, `WalletId`, …)
4. Success response shape — what fields confirm the debit + return a payment-side reference?
5. Idempotency — if we retry the same `RefNo`, do you debit again or return the prior response?

Once we have those, we can wire `Air_Ticketing` with `Ticketing_Type=1` (or `2` — please clarify the difference) and complete the loop.

**Other things we'd appreciate:**

- **`Search_Key` TTL** in minutes — we need to size our cache.
- **Production endpoint URL + IP whitelisting process.** Staging accepts requests from any IP (we send `127.0.0.1` in the auth header and it works); we assume production is gated. Our production egress IP will come from our hosting provider once finalised.

---

### Our reverse-engineered contracts (please confirm)

```jsonc
// POST /airlinehost/AirAPIService.svc/JSONService/Air_TempBooking
{
  "Auth_Header": { /* standard */ },
  "BookingFlightDetails": [
    { "Search_Key": "...", "Flight_Key": "...", "Fare_Id": "..." }
  ],
  "Passenger_Email": "agent@tripbng.dev",
  "Passenger_Mobile": "9999999999",   // 10-digit, no country code
  "PAX_Details": [
    {
      "Title": "MR", "First_Name": "...", "Last_Name": "...",
      "Pax_type": 0,                  // 0=ADT, 1=CHD, 2=INF
      "DOB": "DD/MM/YYYY"             // required for ADT per Required_PAX_Details
      // optional: Gender, Age, Nationality, Passport_*
    }
  ]
}
// → { Response_Header: {Error_Code: "0000"}, Booking_RefNo: "F-..." }
```

```jsonc
// POST /airlinehost/AirAPIService.svc/JSONService/Air_Ticketing
{
  "Auth_Header": { /* standard */ },
  "Booking_RefNo": "F-...",
  "Ticketing_Type": 0    // 0 = Hold (no payment); 1 / 2 = Issue (require AddPayment first)
}
// → { Response_Header: {Error_Code: "0000"}, ... }
```

---

## P1 — Need before public launch (2–4 weeks)

Post-booking flow, ancillaries, and operational visibility.

5. **Specs for the post-booking endpoints**:
   - `Air_History` — booking timeline + status retrieval
   - `Air_Cancellation` + `Air_GetCancelPenalty` — cancel ticket and preview penalty
   - `Air_Reprint` — re-issue the e-ticket PDF
   - `Air_ReleasePNR` — drop a held PNR before payment

6. **Specs for ancillaries**:
   - `Air_GetSSR` — pre-ticket meals / baggage / wheelchair selection
   - `Air_GetSeatMap` — seat map render
   - `Air_GetPostSSR` / `Air_InitiatePostSSR` / `Air_ConfirmPostSSR` — adding ancillaries after a ticket is issued (we understand this is a 3-step flow because of post-ticket payment authorization — please confirm)

7. **Complete `Error_Code` dictionary**. Specifically:
   - Every code value with a human description
   - Whether each is retryable as-is or needs a re-search
   - Distinct codes for: session expired vs auth failure vs availability gone vs price changed vs supplier timeout
   - Full list of `Status_Id` values + meanings (we currently see `"11"` on success — what are the others?)

8. **Booking semantics clarifications** (from our reading of the Search spec):
   - Difference between `Booking_Type: 1` (RoundTrip) and `Booking_Type: 2` (SpecialRoundTrip)
   - `SinglePricing` flag in Reprice — when `false`?
   - `Trip_Id` semantics — when is it `1` (return) vs always `0`?
   - Multi-city: max segments? Pricing model — combined or per-leg?
   - LCC vs GDS: does `TempBooking` auto-ticket for LCCs, or is `Air_Ticketing` always a separate call?
   - PNR hold duration for GDS bookings — standard or carrier-specific?

---

## P2 — Operational + compliance (need by go-live)

9. **`GetBalance`** spec — wallet/credit balance check. We noted this lives on a different host (`tradehost/TradeAPIService.svc/JSONService/`) — please confirm and share endpoint details.

10. **`GST_Input` request schema.** Our agencies are India-based corporate travel platforms; GSTIN-tagged invoicing for input tax credit is mandatory. Please share the object shape we should pass.

11. **TDS field semantics.** In `FareDetails.TDS`: is this informational (we owe) or already deducted from the supplier-side payout?

12. **Rate limits.** Calls per second, calls per day, per agent — for both Search and post-booking endpoints.

13. **Webhooks / callbacks** for booking status changes. Specifically: airline-initiated cancellation, schedule changes, gate changes. If you don't push notifications, we'll poll `Air_History` for upcoming bookings — but a push channel is our preference.

14. **Sample e-ticket PDF** (any sector, any airline) for our design reference. The Postman docs mention barcode formatting but don't include the spec — please share that too.

15. **`IMEI_Number` purpose** in a server-server context. Any required format? We're currently sending a fixed string `"tripbng-server"`.

16. **Sandbox refresh policy.** How often is staging data updated? Are there any test PNRs we should use for end-to-end testing of the booking flow?

17. **Log retention.** Can your team pull request/response logs by `Request_Id` for production debugging? We're sending a UUID v4 per call.

---

## What we have working today

For context, here's where the integration sits — so you know what's already validated against your docs:

- `Air_Search` — full request mapper, multi-fare result parsing (one option per Flight × Fare tuple), seat-availability extraction, free-baggage string parsing (`OB-...RT-...` and unprefixed variants), per-pax-type fare breakdown to base/taxes
- `Air_FareRule` — HTML blob fetched and rendered in a sandboxed iframe in our agent UI
- `Air_Reprice` — called automatically before booking confirmation; price-change modal blocks the agent until they acknowledge any price drift; `Required_PAX_Details` translates into a dynamic per-fare requirements display
- Auth header builder injects a fresh UUID v4 `Request_Id` per call
- Circuit breaker + 18-second timeout per call; failures don't block the rest of our supplier set
- Error code mapper — currently returns the raw eTrav `Error_Desc` for unknown codes; will harden as your dictionary lands
- All credentials are in environment variables, never logged, never reach the React frontend

Everything sits behind an `ETRAV_ENABLED` feature flag, off by default, until we have whitelist confirmation.

---

## Timeline

We'd like to have agencies booking via eTrav within **6 weeks**. That gives us:
- Week 1–2 — receive P0 specs, complete TempBooking → Add-Payment → Ticketing wiring against staging
- Week 3 — receive P1 specs, ship cancel + history + SSR + seat map
- Week 4 — UAT + dry-run with a pilot agency
- Week 5 — soft launch
- Week 6 — production cutover

Anything you can send sooner accelerates that.

---

Thanks for the support. Looking forward to your response.

Best,
[Your Name]
[Title]
TripBng
[Phone] · [Email]
