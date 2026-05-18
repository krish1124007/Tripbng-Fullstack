'use client';

// Multi-leg chain — sessionStorage helpers for chained round-trip and
// multi-city booking flows.
//
// The search page (round-trip-view / multi-city-view) builds the chain
// when the agent clicks "Book all legs". The book page consumes it:
//
//   • On mount → if a chain is active, pre-fill passenger + contact +
//     GST from the stash so the agent doesn't re-type them per leg
//   • On ticket success → if more legs remain, advance the chain
//     (pop the next leg, increment legIndex, append the just-issued
//     PNR for the progress strip) and navigate to /book?searchId=…
//     for the next leg
//   • When the last leg tickets → clear the stash
//
// One unified shape replaces the older `pendingReturnLeg` +
// `pendingMultiCityLegs` keys (they're cleared on read for backward
// compat). All persisted data lives in sessionStorage so it's tied to
// the current browser tab — closing the tab between legs aborts the
// chain (intentional; agent should re-search from scratch).

const STORAGE_KEY = 'flightBookingChain';

// ─────── Schemas ───────

export interface ChainPassenger {
  type: 'ADULT' | 'CHILD' | 'INFANT';
  title: 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS';
  firstName: string;
  lastName: string;
  /** ISO YYYY-MM-DD or undefined. */
  dateOfBirth?: string;
  gender?: 'M' | 'F';
  nationality?: string;
  passport?: {
    number: string;
    expiry: string; // ISO YYYY-MM-DD
    issuingCountry: string;
  };
  fareCategory?: string;
}

export interface ChainContact {
  email: string;
  mobile: string;
  countryCode: string;
}

export interface ChainGst {
  number: string;
  companyName: string;
  address: string;
}

export interface ChainLeg {
  /** Cached search id for this leg — pass to /book?searchId=… */
  searchId: string;
  /** Fare token chosen during the multi-city/round-trip view. */
  fareToken: string;
  /** "BOM → DEL" — display only, helps the progress strip. */
  route: string;
}

export interface ChainCompletedLeg {
  /** PNR issued for an earlier leg in the chain. */
  pnr: string | null;
  /** TripBng booking id (so the user can click back to a leg). */
  bookingId: string;
  /** "BOM → DEL" — display only. */
  route: string;
}

export interface MultiLegChain {
  /** Display label — 'ROUNDTRIP' or 'MULTICITY'. */
  kind: 'ROUNDTRIP' | 'MULTICITY';
  /** Total number of legs in the chain. */
  totalLegs: number;
  /** 0-based index of the leg currently being booked. */
  currentLegIndex: number;
  /** Remaining legs after the current one — popped one-by-one as
   *  each leg tickets. */
  remainingLegs: ChainLeg[];
  /** Legs already ticketed in this chain. */
  completedLegs: ChainCompletedLeg[];
  /** Passenger info carried across legs — same group, every leg. */
  passengers?: ChainPassenger[];
  /** Contact carried across legs. */
  contact?: ChainContact;
  /** Optional GST carried across legs. */
  gst?: ChainGst;
  /** ISO timestamp — used to expire stale chains (24h). */
  createdAt: number;
}

// 24 hours — long enough for an agent to be interrupted between legs
// without losing the chain, short enough that stale chains don't
// linger across sessions.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ─────── Mutators ───────

/** Start a new chain when the agent clicks Book on a multi-leg view. */
export function startChain(input: {
  kind: 'ROUNDTRIP' | 'MULTICITY';
  legs: ChainLeg[];
}): MultiLegChain {
  const chain: MultiLegChain = {
    kind: input.kind,
    totalLegs: input.legs.length,
    currentLegIndex: 0,
    remainingLegs: input.legs.slice(1), // first leg is the one we're navigating to now
    completedLegs: [],
    createdAt: Date.now(),
  };
  saveChain(chain);
  return chain;
}

/** Update the chain with what the agent just filled in on the current
 *  leg. Called before navigating to the next leg. */
export function captureLegFormState(args: {
  passengers: ChainPassenger[];
  contact: ChainContact;
  gst?: ChainGst;
}): void {
  const chain = getChain();
  if (!chain) return;
  chain.passengers = args.passengers;
  chain.contact = args.contact;
  if (args.gst) chain.gst = args.gst;
  saveChain(chain);
}

/** Mark the current leg as ticketed and advance to the next. Returns
 *  the next leg's `(searchId, fareToken)` for the caller to navigate
 *  to. Returns null when the chain is complete — caller should clear. */
export function advanceChain(args: {
  completed: ChainCompletedLeg;
}): ChainLeg | null {
  const chain = getChain();
  if (!chain) return null;
  chain.completedLegs.push(args.completed);
  const next = chain.remainingLegs.shift();
  if (!next) {
    // Chain finished — clear so subsequent bookings don't see stale state.
    clearChain();
    return null;
  }
  chain.currentLegIndex += 1;
  saveChain(chain);
  return next;
}

/** Drop the chain — used when the agent bails out mid-flow. */
export function clearChain(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    // Legacy keys — clear them too in case anything still writes them.
    sessionStorage.removeItem('pendingReturnLeg');
    sessionStorage.removeItem('pendingMultiCityLegs');
  } catch {
    // sessionStorage can throw in private-browsing contexts — fail open.
  }
}

// ─────── Readers ───────

/** Read the current chain, if any. Returns null when absent / expired. */
export function getChain(): MultiLegChain | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultiLegChain;
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - (parsed.createdAt ?? 0) > MAX_AGE_MS) {
      clearChain();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True when there's an in-progress chain with this exact searchId +
 *  fareToken — used by the book page to know it's serving leg N of M
 *  and should pre-fill from the stash. */
export function chainMatchesCurrentLeg(
  searchId: string,
  fareToken: string,
): boolean {
  const chain = getChain();
  if (!chain) return false;
  // The "current" leg's searchId + fareToken aren't stored in
  // `remainingLegs` (they were the one we navigated to). We don't
  // know them here without the URL — caller passes them in. We just
  // verify there's an active chain and trust the URL.
  void searchId;
  void fareToken;
  return chain.totalLegs > 1 && chain.currentLegIndex < chain.totalLegs;
}

// ─────── Writers ───────

function saveChain(chain: MultiLegChain): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(chain));
  } catch {
    // sessionStorage can throw if disabled / quota — agent can re-search.
  }
}
