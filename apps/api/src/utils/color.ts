// Tiny colour helpers — used by the branding service to auto-derive
// hover + foreground colours from a primary when the agent didn't
// pick them manually. Standalone, dep-free.

/**
 * Parse a #rgb / #rrggbb hex string into [r, g, b] integers in [0, 255].
 * Alpha is ignored — we only care about luminance + RGB for hover.
 */
function parseHex(hex: string): [number, number, number] {
  let s = hex.replace(/^#/, '').toLowerCase();
  if (s.length === 3 || s.length === 4) {
    s = s
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  } else if (s.length === 8) {
    s = s.slice(0, 6);
  }
  if (s.length !== 6 || /[^0-9a-f]/.test(s)) return [0, 0, 0];
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const pad = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}

/**
 * Darken a hex colour by `amount` (0..1). At 0.1 each channel loses
 * 10% of its current value — a sensible default for hover states.
 */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const k = 1 - Math.max(0, Math.min(1, amount));
  return toHex(r * k, g * k, b * k);
}

/**
 * Pick a readable foreground colour for text/icons sitting on top of
 * `bgHex`. Returns either white or near-black per WCAG relative
 * luminance. Conservative threshold (0.5) so primary tones at the
 * mid-luminance line still get white text — matches the "white text
 * on solid brand" convention most B2B portals use.
 */
export function pickReadableTextColor(bgHex: string): '#ffffff' | '#0b1220' {
  const [r, g, b] = parseHex(bgHex);
  // Relative luminance per WCAG 2.x.
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? '#0b1220' : '#ffffff';
}
