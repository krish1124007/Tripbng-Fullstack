// Forced-seats parser.
//
// SeatSeller emits a single `forcedSeats` field on the trip-details
// response that compresses TWO lists separated by '@':
//
//   <femaleSeats>@<maleSeats>
//
// Both halves are comma-separated seat-name lists; either half can be
// empty. Examples (verbatim from SeatSeller fixtures):
//
//   "L4,L3@U7,U8"    → female ["L4","L3"], male ["U7","U8"]
//   "U11@"           → female ["U11"], male []
//   "@A1,A2"         → female [], male ["A1","A2"]
//   ""               → female [], male []
//
// UI rule (CLAUDE.md §13): if any forcedSeat exists for a gender, the
// user MUST pick from that list before any other seat is selectable for
// that gender. The parser doesn't enforce that — it just exposes the
// two lists. The seat-layout component uses them.

export interface ForcedSeats {
  female: string[];
  male: string[];
}

/**
 * Parse the SeatSeller `forcedSeats` string into typed lists. Pure
 * function — defensive against odd inputs:
 *
 *  - Trims whitespace around every seat name.
 *  - Drops empty tokens (e.g. "L4,,L3" → ["L4","L3"]).
 *  - Treats the absence of '@' as "all entries are female-forced" (matches
 *    SeatSeller's older single-list shape — kept for fixture-replay safety).
 *  - Returns frozen lists so callers can't mutate the result and corrupt
 *    a cached parse.
 */
export function parseForcedSeats(raw: string | null | undefined): ForcedSeats {
  if (!raw || raw.trim().length === 0) {
    return { female: [], male: [] };
  }

  const trimmed = raw.trim();
  // Split on '@'. limit=2 because seat names can't legitimately contain '@'.
  const at = trimmed.indexOf('@');

  let femaleRaw: string;
  let maleRaw: string;
  if (at === -1) {
    // Older shape — treat the whole string as female-forced.
    femaleRaw = trimmed;
    maleRaw = '';
  } else {
    femaleRaw = trimmed.slice(0, at);
    maleRaw = trimmed.slice(at + 1);
  }

  return {
    female: tokenize(femaleRaw),
    male: tokenize(maleRaw),
  };
}

function tokenize(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Test whether a passenger of the given gender is allowed to pick an
 * arbitrary seat. Returns:
 *   - { ok: true } when no forcedSeats exist for that gender, or the
 *     passenger picked one of the forced seats
 *   - { ok: false, mustPick: [...] } when the passenger needs to pick
 *     from the forced list before they can use any other seat
 *
 * The seat-layout component calls this before allowing free selection.
 */
export function canPickFreely(
  gender: 'MALE' | 'FEMALE' | 'OTHER',
  forced: ForcedSeats,
  alreadyPickedSeats: string[],
): { ok: true } | { ok: false; mustPick: string[] } {
  // OTHER gender: SeatSeller doesn't reserve seats for non-binary; treat
  // as free-pick. (Booking flow validates this against operator rules
  // before submitting; some operators reject OTHER outright.)
  if (gender === 'OTHER') return { ok: true };

  const forcedList = gender === 'FEMALE' ? forced.female : forced.male;
  if (forcedList.length === 0) return { ok: true };

  // If the passenger has picked one of the forced seats, they're free
  // to pick more (e.g. for a multi-pax booking where two adults of the
  // same gender share). The "forced" rule is "must include AT LEAST ONE
  // forced seat" — not "every seat must be forced".
  const picked = new Set(alreadyPickedSeats);
  const usedAnyForced = forcedList.some((s) => picked.has(s));
  if (usedAnyForced) return { ok: true };

  return { ok: false, mustPick: forcedList };
}
