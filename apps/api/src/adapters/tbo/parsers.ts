// Defensive list extractors for TBO list responses.
//
// TBO's API docs across versions use four different envelope shapes for
// the same logical "list of X" responses:
//
//   1. Flat array:           { CountryList: [ ... ] }
//   2. Single-key wrapped:   { CountryList: { Country: [ ... ] } }
//   3. Hoisted differently:  { Countries: [ ... ] }
//   4. XML-in-string:        { CountryList: "<Countries><Country>…</Country></Countries>" }
//
// Shape 4 is what TBO's SharedData CountryList returns in production for
// some accounts (the JSON `CountryData` sibling stays empty). We detect it
// by string-with-leading-< at any candidate path and parse with a small
// regex tokenizer — sufficient for TBO's simple flat envelopes; pull in
// fast-xml-parser when we need attributes/nesting.
//
// Rather than write a separate parser per method per shape, we expose one
// helper that walks the common candidate paths in order and returns the
// first array it finds. If none match we return [] — the call site logs
// + persists the raw response (via the audit interceptor) so we can refine
// the candidate list when we see drift.

/**
 * Try each candidate path on `obj` and return the first array we find.
 * Each path is a dotted string ("CountryList.Country"). Empty array if no
 * candidate hits — caller decides whether that's an error or "empty page".
 */
export function unwrapList<T>(obj: Record<string, unknown> | null | undefined, paths: string[]): T[] {
  if (!obj) return [];
  for (const path of paths) {
    const v = readPath(obj, path);
    if (Array.isArray(v)) return v as T[];
  }
  // Fallback: XML-in-string envelope (TBO SharedData CountryList).
  for (const path of paths) {
    const v = readPath(obj, path);
    if (typeof v === 'string' && v.trim().startsWith('<')) {
      const items = parseSimpleXmlList<T>(v);
      if (items.length > 0) return items;
    }
  }
  return [];
}

/**
 * Parse a flat TBO XML list. Expects a single outer wrapper containing N
 * sibling elements with the same tag name, each containing simple
 * `<Field>value</Field>` pairs. Decodes the five standard XML entities.
 * Returns an empty array on any structural mismatch — callers fall back
 * to other strategies.
 *
 * Example:
 *   <Countries>
 *     <Country><Code>AF</Code><Name>Afghanistan</Name></Country>
 *     ...
 *   </Countries>
 *   →  [{ Code: 'AF', Name: 'Afghanistan' }, …]
 */
export function parseSimpleXmlList<T>(xml: string): T[] {
  const trimmed = xml.trim();
  const wrapMatch = /^<([A-Za-z0-9_]+)[^>]*>([\s\S]*)<\/\1>$/.exec(trimmed);
  if (!wrapMatch) return [];
  const inner = wrapMatch[2];
  const childMatch = /<([A-Za-z0-9_]+)[\s>]/.exec(inner);
  if (!childMatch) return [];
  const childTag = childMatch[1];
  const itemRe = new RegExp(`<${childTag}\\b[^>]*>([\\s\\S]*?)</${childTag}>`, 'g');
  const items: T[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(inner)) !== null) {
    items.push(parseXmlFields<T>(m[1]));
  }
  return items;
}

function parseXmlFields<T>(itemXml: string): T {
  const out: Record<string, string> = {};
  const fieldRe = /<([A-Za-z0-9_]+)[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(itemXml)) !== null) {
    out[m[1]] = decodeXmlEntities(m[2]);
  }
  return out as unknown as T;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Coerce numeric-or-string values from TBO into number or null. Lat/lng,
 *  star ratings, and hotel counts are all returned as strings in some
 *  endpoints but numbers in others — this normalises. */
export function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trim a string, return null when empty. Useful for TBO's "" → "absent"
 *  semantics. */
export function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/** Coerce TBO's amenity/facility shapes (string CSV, array of strings, array
 *  of {Name}) into a clean string[]. */
export function normalizeStringList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object' && 'Name' in item) {
          return String((item as { Name?: unknown }).Name ?? '').trim();
        }
        return '';
      })
      .filter((s) => s.length > 0);
  }
  if (typeof v === 'string') {
    return v
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
