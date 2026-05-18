// PII + secret redaction for TBO audit logs.
//
// TBO requests carry Password and (later, in PreBook/Book) PAN, passport,
// phone, email. We never persist those raw — every request body is run
// through `redactForAudit` before insert. Same applies to responses (some
// TBO endpoints echo back the inputs).
//
// Redaction is structural — keys are matched case-insensitively. Anything
// matching a sensitive key is replaced with the literal string "[REDACTED]"
// so the audit log retains shape (useful for grep) without leaking content.

const SENSITIVE_KEYS = new Set(
  [
    // Auth
    'password',
    'tokenid',
    // Identity docs (will appear once Book is implemented)
    'pan',
    'passportno',
    'passportnumber',
    'passport',
    'passportissuedate',
    'passportexpdate',
    'passportexpiry',
    // Personally identifying contact info
    'email',
    'phone',
    'phoneno',
    'mobile',
    'mobileno',
    // Tax
    'gstin',
  ].map((s) => s.toLowerCase()),
);

const REDACTED = '[REDACTED]';

/**
 * Deep-clone with sensitive fields replaced. Handles nested objects and
 * arrays. Non-object inputs are returned as-is.
 */
export function redactForAudit<T>(value: T): T {
  return walk(value) as T;
}

function walk(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map(walk);
  if (typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else {
      out[key] = walk(val);
    }
  }
  return out;
}
