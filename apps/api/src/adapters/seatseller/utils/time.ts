// SeatSeller time-format utilities.
//
// SeatSeller represents trip times as "minutes from 00:00 IST on the day
// of journey". Anything ≥ 1440 minutes (24*60) means the time is on the
// following calendar day — that's how they encode overnight buses without
// changing the response shape per-trip.
//
// Pure functions only — no I/O, no globals, no Date.now(). Easy to unit
// test against the table the spec mandates (CLAUDE.md §11).

/**
 * Convert SeatSeller's "minutes since DOJ-midnight IST" representation
 * into a UTC Date instant.
 *
 * Notes:
 *  - `doj` is interpreted as the IST midnight of the journey day. The
 *    caller is responsible for constructing it correctly (see the
 *    `dojFromIstDateString` helper below).
 *  - Values above 1440 wrap into next-day (overnight). Values can be 0
 *    (midnight) or negative? SeatSeller spec says non-negative; we still
 *    clamp to >= 0 defensively to avoid silent date drift.
 *
 * Test cases that MUST pass (CLAUDE.md §11):
 *   2026-01-26 +   15  →  26 Jan 00:15 IST
 *   2026-01-26 + 1295  →  26 Jan 21:35 IST
 *   2026-01-26 + 1500  →  27 Jan 01:00 IST
 *   2026-01-26 +    0  →  26 Jan 00:00 IST
 */
export function ssMinutesToDate(doj: Date, ssMinutes: number): Date {
  const m = Math.max(0, Math.floor(ssMinutes));
  // doj is IST midnight; its UTC instant is doj-IST minus 5h30m.
  // Adding `m` minutes lands on the correct UTC instant for the trip time.
  return new Date(doj.getTime() + m * 60_000);
}

/**
 * Build the canonical doj Date from a "yyyy-MM-dd" date string. The
 * returned instant represents 00:00 IST on that day in UTC, i.e.
 * 18:30 the previous day in UTC. Use this everywhere the booking flow
 * needs a doj — never construct doj from `new Date('yyyy-MM-dd')` which
 * would parse as UTC midnight and shift the trip by 5h30m.
 */
export function dojFromIstDateString(yyyyMmDd: string): Date {
  // Validate shape strictly: SeatSeller rejects malformed dates anyway,
  // we just want a clearer error from our side.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) {
    throw new Error(`dojFromIstDateString: expected yyyy-MM-dd, got "${yyyyMmDd}"`);
  }
  const [, yStr, mStr, dStr] = m;
  const y = Number.parseInt(yStr!, 10);
  const month = Number.parseInt(mStr!, 10);
  const day = Number.parseInt(dStr!, 10);

  // 'yyyy-MM-ddT00:00:00+05:30' parses as IST midnight in UTC terms.
  const d = new Date(`${yyyyMmDd}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`dojFromIstDateString: invalid date "${yyyyMmDd}"`);
  }
  // JS Date constructor silently rolls over Feb 30 → Mar 02, etc. Re-read
  // the IST components and reject if they don't match the input — catches
  // every "impossible calendar date" case (Feb 30, Apr 31, ...).
  const ist = new Date(d.getTime() + 5.5 * 60 * 60_000);
  if (
    ist.getUTCFullYear() !== y ||
    ist.getUTCMonth() + 1 !== month ||
    ist.getUTCDate() !== day
  ) {
    throw new Error(`dojFromIstDateString: invalid calendar date "${yyyyMmDd}"`);
  }
  return d;
}

/**
 * Format an arbitrary Date as "yyyy-MM-dd" in IST. Used for SeatSeller
 * request bodies where they want the journey date (not a timestamp).
 */
export function dateToIstYyyyMmDd(d: Date): string {
  // Convert UTC instant → IST by adding 5h30m, then read the YMD components.
  const ist = new Date(d.getTime() + 5.5 * 60 * 60_000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Determine whether a trip "crosses midnight" — i.e. departs on doj but
 * arrives on doj+1 in IST. Used to surface the red "next day" badge on
 * the seat-layout UI.
 */
export function isNextDayArrival(departureMinutes: number, arrivalMinutes: number): boolean {
  // SeatSeller already encodes next-day as arrivalMinutes >= 1440. But
  // some operators emit arrivalMinutes < departureMinutes (e.g. dep=1320,
  // arr=120) — also next-day. Catch both.
  if (arrivalMinutes >= 1440) return true;
  if (arrivalMinutes < departureMinutes) return true;
  return false;
}
