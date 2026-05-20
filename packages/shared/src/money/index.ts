// Money utility — the single source of truth for monetary values in the wallet
// system. Every amount is stored as `Paise` (a `bigint` count of 1/100ths of a
// rupee). Floating-point arithmetic on money is banned.
//
// Why bigint and not bignumber.js: paise are already the smallest unit we ever
// transact in, so we never need sub-paise fractions in storage. The only place
// fractions appear is during percent calculations (incentive, TDS), and we
// handle that with explicit integer division + a chosen `RoundingMode`. bigint
// is built into the runtime, has no dependency cost, and is impossible to
// accidentally mix with `Number`.

/**
 * The smallest unit of money in this system. 1 INR = 100 paise.
 *
 * Strict bigint — `number` paise values from legacy code must go through
 * {@link fromNumberPaise} or {@link toNumberPaise} at the boundary.
 */
export type Paise = bigint;

/** Zero amount. Useful as an initial accumulator or comparison target. */
export const ZERO: Paise = 0n;

// ─────────────────────────────────────────────────────────────────────────────
// Conversions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap an integer `number` of paise into the `Paise` type. Throws if the
 * input isn't a finite integer — the schema-level guarantee in our Mongoose
 * models is that all paise fields are integers, so a non-integer here is a bug.
 *
 * Use this at the boundary when reading legacy `number`-paise fields off Mongo
 * documents (e.g. `Agency.walletBalance`).
 */
export function fromNumberPaise(n: number): Paise {
  if (!Number.isFinite(n)) {
    throw new RangeError(`Money: expected finite paise, got ${n}`);
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(`Money: expected integer paise, got ${n}`);
  }
  return BigInt(n);
}

/**
 * Convert a `Paise` value back to a `number` of paise — used at the boundary
 * when writing to legacy `number`-paise Mongoose fields. Throws if the value
 * exceeds `Number.MAX_SAFE_INTEGER` (≈ ₹90 trillion) to prevent silent
 * precision loss.
 */
export function toNumberPaise(p: Paise): number {
  if (p > BigInt(Number.MAX_SAFE_INTEGER) || p < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `Money: ${p} paise exceeds Number.MAX_SAFE_INTEGER; cannot downcast safely`,
    );
  }
  return Number(p);
}

/**
 * Parse a rupee value (number like `1234.5` or string like `"1,234.50"`) into
 * paise. Anything beyond 2 decimal places is rounded per `mode` (default
 * `half-up`, which matches Indian accounting convention).
 *
 * Examples:
 *   fromRupees(1234.5)        → 123450n
 *   fromRupees("1,000.999")   → 100100n   (half-up)
 *   fromRupees("-50.005")     → -5001n    (half-up, away from zero)
 */
export function fromRupees(input: number | string, mode: RoundingMode = 'half-up'): Paise {
  const raw = typeof input === 'number' ? input.toString() : input.trim();
  // Strip commas (Indian + US grouping) and a leading '+'.
  const cleaned = raw.replace(/,/g, '').replace(/^\+/, '');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) {
    throw new RangeError(`Money: invalid rupee value "${input}"`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2]!;
  const fracPart = match[3] ?? '';
  // Pad fractional to at least 2 digits so we can lift the decimal cleanly.
  const padded = fracPart.padEnd(2, '0');
  let paise = BigInt(intPart) * 100n + BigInt(padded.slice(0, 2));
  // Anything beyond 2 fractional digits drives rounding.
  const beyond = padded.slice(2);
  if (beyond.length > 0) {
    const first = beyond.charCodeAt(0) - 48; // '0' → 0
    const restHasNonZero = beyond.slice(1).split('').some((c) => c !== '0');
    if (mode === 'down') {
      // truncate — already done
    } else if (mode === 'half-up') {
      // Round half-away-from-zero. Sign restored below, so "up" here = "+1".
      if (first >= 5) paise += 1n;
    } else if (mode === 'half-even') {
      if (first > 5 || (first === 5 && restHasNonZero)) {
        paise += 1n;
      } else if (first === 5 && !restHasNonZero) {
        if (paise % 2n === 1n) paise += 1n;
      }
    }
  }
  return sign * paise;
}

/**
 * Format `Paise` as a plain decimal rupee string with exactly 2 decimal places.
 * No currency symbol, no thousand-separators — use {@link formatINR} for
 * presentation. Useful for CSV exports or as a stable lossless representation.
 *
 *   toRupeesString(100980n)  → "1009.80"
 *   toRupeesString(-50n)     → "-0.50"
 */
export function toRupeesString(p: Paise): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const rupees = abs / 100n;
  const paiseRem = abs % 100n;
  return `${negative ? '-' : ''}${rupees.toString()}.${paiseRem.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format `Paise` for display in Indian locale: `"₹1,00,980.00"`.
 *
 * Note: this downcasts to `number` for `Intl.NumberFormat`. That's safe up to
 * ~₹90 trillion (Number.MAX_SAFE_INTEGER / 100). Above that we throw — well
 * outside any realistic B2B travel volume.
 */
export function formatINR(p: Paise): string {
  const rupees = toNumberPaise(p) / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Compact INR formatting — no decimals. Use in dashboard cards where the paise
 * portion is noise: `"₹1,00,980"`.
 */
export function formatINRCompact(p: Paise): string {
  const rupees = toNumberPaise(p) / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────────────

export const isZero = (p: Paise): boolean => p === 0n;
export const isPositive = (p: Paise): boolean => p > 0n;
export const isNegative = (p: Paise): boolean => p < 0n;
export const eq = (a: Paise, b: Paise): boolean => a === b;
export const gt = (a: Paise, b: Paise): boolean => a > b;
export const gte = (a: Paise, b: Paise): boolean => a >= b;
export const lt = (a: Paise, b: Paise): boolean => a < b;
export const lte = (a: Paise, b: Paise): boolean => a <= b;

// ─────────────────────────────────────────────────────────────────────────────
// Arithmetic
// ─────────────────────────────────────────────────────────────────────────────

export const add = (a: Paise, b: Paise): Paise => a + b;
export const sub = (a: Paise, b: Paise): Paise => a - b;
export const min = (a: Paise, b: Paise): Paise => (a <= b ? a : b);
export const max = (a: Paise, b: Paise): Paise => (a >= b ? a : b);

/** Sum any number of Paise values. */
export function sumAll(values: readonly Paise[]): Paise {
  let total: Paise = 0n;
  for (const v of values) total += v;
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Percent helpers (the ONLY exposed multiplication — generic `mul` is too
// rounding-hazardous to expose, callers should always use one of these).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How to round when integer division has a non-zero remainder.
 *
 * - `half-up` — round halves away from zero. Standard Indian accounting +
 *   TDS convention. Default.
 * - `half-even` — banker's rounding. Use when accumulating many percentage
 *   calculations and statistical bias matters (rare in our domain).
 * - `down` — truncate toward zero. Use for fee calculations where the platform
 *   never rounds up against the user.
 */
export type RoundingMode = 'half-up' | 'half-even' | 'down';

/**
 * `p * percent / 100`, rounded to integer paise.
 *
 *   percent(10_00_000n, 1)     → 10000n     (1% of ₹10,000 → ₹100)
 *   percent(100_000n, 2)       → 2000n      (2% TDS on ₹1,000 → ₹20)
 *   percent(100_000n, 0.5)     → 500n
 *
 * `percent` is a `number` for caller convenience. To get exact precision on
 * unusual values (e.g. 0.0123%), use {@link percentBasisPoints} which takes an
 * integer basis-points value.
 */
export function percent(p: Paise, percent: number, mode: RoundingMode = 'half-up'): Paise {
  if (!Number.isFinite(percent)) {
    throw new RangeError(`Money.percent: percent must be finite, got ${percent}`);
  }
  // Scale percent by 1e4 so 0.0001% precision is exact for finite floats up to
  // ±2^53/1e4 (~9e11 %), well beyond any business input.
  const SCALE = 10_000n;
  const pctScaled = BigInt(Math.round(percent * 10_000));
  return divideRounded(p * pctScaled, 100n * SCALE, mode);
}

/**
 * `p * basisPoints / 10_000`, rounded to integer paise. Basis points are
 * integer-only (1 bp = 0.01%). Use this when you have a known integer-bp value
 * — it avoids any float rounding on the percent input.
 *
 *   percentBasisPoints(100_000n, 200)   → 2000n   (2% TDS = 200 bp)
 *   percentBasisPoints(100_000n, 1800)  → 18000n  (18% GST = 1800 bp)
 */
export function percentBasisPoints(
  p: Paise,
  basisPoints: number,
  mode: RoundingMode = 'half-up',
): Paise {
  if (!Number.isInteger(basisPoints)) {
    throw new TypeError(
      `Money.percentBasisPoints: basisPoints must be integer, got ${basisPoints}`,
    );
  }
  return divideRounded(p * BigInt(basisPoints), 10_000n, mode);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Integer division of `numerator / denominator` with explicit rounding mode.
 * Sign is restored at the end so all rounding modes behave symmetrically across
 * zero (`half-up` of -1.5 = -2, not -1).
 */
function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new RangeError('Money: division by zero');
  }
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;
  const q = absN / absD;
  const r = absN % absD;
  if (r === 0n) return sign * q;
  let rounded = q;
  if (mode === 'down') {
    // truncate toward zero — q already is
  } else if (mode === 'half-up') {
    if (r * 2n >= absD) rounded += 1n;
  } else if (mode === 'half-even') {
    const doubled = r * 2n;
    if (doubled > absD) {
      rounded += 1n;
    } else if (doubled === absD) {
      // Exact half — round to even.
      if (rounded % 2n === 1n) rounded += 1n;
    }
  }
  return sign * rounded;
}
