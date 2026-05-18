// IST timezone math for TBO token lifecycle.
//
// TBO tokens are valid 00:00–23:59 of the calendar day on which they were
// issued, IST. The cache TTL must be `secondsUntilNextMidnightIST() - buffer`
// so the token rotates before TBO invalidates it.
//
// Why a hand-rolled helper (vs date-fns-tz / Luxon): both add ~30KB and we
// need exactly one operation. JS Date is UTC-aware and Intl gives us IST
// formatting — that's enough.

const IST_OFFSET_MIN = 5 * 60 + 30; // +05:30

/**
 * Seconds remaining until the next midnight in IST. When called at exactly
 * IST midnight, returns 86_400 (the full next day) — never zero, so the
 * cache always has a positive TTL.
 */
export function secondsUntilNextMidnightIST(now: Date = new Date()): number {
  const istMs = now.getTime() + IST_OFFSET_MIN * 60 * 1000;
  // Floor to the start of the IST day.
  const istDayStartMs = Math.floor(istMs / 86_400_000) * 86_400_000;
  // Next midnight IST = start of NEXT day.
  const nextIstMidnightMs = istDayStartMs + 86_400_000;
  // Translate back to UTC for the comparison with `now`.
  const nextMidnightUtcMs = nextIstMidnightMs - IST_OFFSET_MIN * 60 * 1000;
  return Math.max(1, Math.floor((nextMidnightUtcMs - now.getTime()) / 1000));
}
