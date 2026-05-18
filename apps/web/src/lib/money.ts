// Money is stored as integer paise everywhere (spec §19). These helpers convert at the
// UI boundary only — never mutate paise into floats elsewhere.
export function formatPaiseAsINR(paise: number, opts: { compact?: boolean } = {}): string {
  const rupees = paise / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.compact ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function rupeesStringToPaise(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

// Format a basis-points-times-100 percentage value (e.g. 1800 → "18.00%").
export function formatPercentBasisPoints(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}
