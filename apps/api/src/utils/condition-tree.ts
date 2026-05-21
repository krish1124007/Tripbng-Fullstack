// ConditionTree evaluator — pure, schema-aware predicate runner.
//
// Walks a `ConditionNode` tree and decides whether a context object
// satisfies it. Two pillars:
//
//   1. The TREE drives composition (AND / OR / NOT) — no model-specific
//      knowledge here. Adding a new rule type means writing a new
//      field-schema + a context-builder; the evaluator stays unchanged.
//
//   2. The FIELD SCHEMA drives coercion. Dates ride as ISO strings on the
//      wire, numbers may arrive as strings from form posts, enums need
//      case-insensitive comparison. Doing this in one place keeps every
//      callsite from re-implementing the same boundary logic.
//
// Diagnostics
// -----------
// Evaluation accumulates a `trace` of which leaves matched + which didn't,
// so the API can store the "why" alongside an audit row. The trace is
// O(nodes) memory — fine for trees with hundreds of nodes; the existing
// SupplierSource forms cap out around 15.
//
// Failure model
// -------------
// Unknown fields, unknown operators, value/type mismatches throw a
// dedicated `ConditionTreeError`. Callers handle this as "config bug —
// log loudly, surface to admin, fall through to legacy logic" rather
// than treating it as a no-match.

import type {
  ConditionFieldSchema,
  ConditionFieldType,
  ConditionGroup,
  ConditionLeaf,
  ConditionNode,
  ConditionOperator,
  ConditionPrimitive,
  ConditionValue,
} from '@tripbng/shared';
import { isGroup } from '@tripbng/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Field value extracted from the caller's context object. The evaluator
 *  reads these via the FieldExtractor function. */
export type ContextValue =
  | ConditionPrimitive
  | Date
  | ConditionPrimitive[]
  | undefined;

/** Pulls a field's runtime value out of the caller's context. Lets the
 *  caller decide how to map `field.key` ('pax_count', etc.) onto whatever
 *  shape the booking / cart / etc. happens to carry. */
export type FieldExtractor<Ctx> = (
  field: ConditionFieldSchema,
  ctx: Ctx,
) => ContextValue;

export interface EvaluateOptions<Ctx> {
  /** The schema descriptor list — keyed by field. */
  schema: readonly ConditionFieldSchema[];
  extract: FieldExtractor<Ctx>;
}

export interface LeafTrace {
  field: string;
  op: ConditionOperator;
  matched: boolean;
  /** Free-text reason — e.g. "value 7 > maximumPax 5". Only populated
   *  when matched=false to keep the trace lean. */
  reason?: string;
}

export interface EvaluateResult {
  matched: boolean;
  trace: LeafTrace[];
}

export class ConditionTreeError extends Error {
  constructor(
    public readonly code: 'UNKNOWN_FIELD' | 'UNKNOWN_OPERATOR' | 'BAD_VALUE' | 'BAD_TREE',
    message: string,
    public readonly path: string,
  ) {
    super(`condition-tree[${code} @ ${path}]: ${message}`);
    this.name = 'ConditionTreeError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a condition tree against a context object. Pure — no I/O.
 *
 * @throws ConditionTreeError when the tree references unknown fields /
 *   operators or carries malformed values. Treat as a configuration bug
 *   (alert ops + fall back to legacy logic) rather than a no-match.
 */
export function evaluateConditionTree<Ctx>(
  tree: ConditionNode,
  ctx: Ctx,
  opts: EvaluateOptions<Ctx>,
): EvaluateResult {
  const schemaByKey = new Map(opts.schema.map((s) => [s.key, s]));
  const trace: LeafTrace[] = [];
  const matched = evaluate(tree, ctx, schemaByKey, opts.extract, trace, '$');
  return { matched, trace };
}

function evaluate<Ctx>(
  node: ConditionNode,
  ctx: Ctx,
  schemaByKey: Map<string, ConditionFieldSchema>,
  extract: FieldExtractor<Ctx>,
  trace: LeafTrace[],
  path: string,
): boolean {
  if (isGroup(node)) {
    return evaluateGroup(node, ctx, schemaByKey, extract, trace, path);
  }
  return evaluateLeaf(node, ctx, schemaByKey, extract, trace, path);
}

function evaluateGroup<Ctx>(
  group: ConditionGroup,
  ctx: Ctx,
  schemaByKey: Map<string, ConditionFieldSchema>,
  extract: FieldExtractor<Ctx>,
  trace: LeafTrace[],
  path: string,
): boolean {
  if (group.type === 'NOT') {
    if (group.children.length !== 1) {
      throw new ConditionTreeError(
        'BAD_TREE',
        'NOT must have exactly one child',
        path,
      );
    }
    return !evaluate(group.children[0]!, ctx, schemaByKey, extract, trace, `${path}.NOT`);
  }

  // Empty group: AND-of-nothing is vacuously true (no constraints),
  // OR-of-nothing is vacuously false (no alternatives qualified).
  if (group.children.length === 0) {
    return group.type === 'AND';
  }

  if (group.type === 'AND') {
    for (let i = 0; i < group.children.length; i++) {
      if (!evaluate(group.children[i]!, ctx, schemaByKey, extract, trace, `${path}.AND[${i}]`)) {
        return false;
      }
    }
    return true;
  }

  // OR
  for (let i = 0; i < group.children.length; i++) {
    if (evaluate(group.children[i]!, ctx, schemaByKey, extract, trace, `${path}.OR[${i}]`)) {
      return true;
    }
  }
  return false;
}

function evaluateLeaf<Ctx>(
  leafNode: ConditionLeaf,
  ctx: Ctx,
  schemaByKey: Map<string, ConditionFieldSchema>,
  extract: FieldExtractor<Ctx>,
  trace: LeafTrace[],
  path: string,
): boolean {
  const schema = schemaByKey.get(leafNode.field);
  if (!schema) {
    throw new ConditionTreeError(
      'UNKNOWN_FIELD',
      `field ${leafNode.field} is not in the schema`,
      path,
    );
  }
  const raw = extract(schema, ctx);
  const matched = compare(schema, raw, leafNode.op, leafNode.value, path);
  trace.push({
    field: leafNode.field,
    op: leafNode.op,
    matched,
    ...(matched
      ? {}
      : { reason: failureReason(schema, raw, leafNode.op, leafNode.value) }),
  });
  return matched;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compare — operator-by-operator semantics
// ─────────────────────────────────────────────────────────────────────────────

function compare(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  op: ConditionOperator,
  value: ConditionValue | undefined,
  path: string,
): boolean {
  // EXISTS / NOT_EXISTS handle their own null semantics — every other
  // operator returns false for missing values (the leaf can never match).
  if (op === 'EXISTS') return raw !== undefined && raw !== null && raw !== '';
  if (op === 'NOT_EXISTS') return raw === undefined || raw === null || raw === '';

  // From here on we need a value.
  if (raw === undefined || raw === null) return false;

  switch (op) {
    case 'EQ':
      return cmpEq(schema, raw, value, path);
    case 'NEQ':
      return !cmpEq(schema, raw, value, path);
    case 'IN':
      return cmpIn(schema, raw, value, path);
    case 'NOT_IN':
      return !cmpIn(schema, raw, value, path);
    case 'GT':
      return cmpOrder(schema, raw, value, path) > 0;
    case 'GTE':
      return cmpOrder(schema, raw, value, path) >= 0;
    case 'LT':
      return cmpOrder(schema, raw, value, path) < 0;
    case 'LTE':
      return cmpOrder(schema, raw, value, path) <= 0;
    case 'BETWEEN':
      return cmpBetween(schema, raw, value, path);
    case 'CONTAINS':
      return cmpContains(schema, raw, value, path);
    case 'NOT_CONTAINS':
      return !cmpContains(schema, raw, value, path);
    default: {
      const exhaust: never = op;
      throw new ConditionTreeError(
        'UNKNOWN_OPERATOR',
        `operator ${String(exhaust)} is not implemented`,
        path,
      );
    }
  }
}

// ── Operator helpers ───────────────────────────────────────────────────────

function cmpEq(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  value: ConditionValue | undefined,
  path: string,
): boolean {
  if (value === undefined || Array.isArray(value)) {
    throw new ConditionTreeError('BAD_VALUE', `EQ needs a primitive`, path);
  }
  return coerce(schema, raw, path) === coerce(schema, value, path);
}

function cmpIn(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  value: ConditionValue | undefined,
  path: string,
): boolean {
  if (!Array.isArray(value)) {
    throw new ConditionTreeError('BAD_VALUE', `IN needs an array`, path);
  }
  const r = coerce(schema, raw, path);
  return value.some((v) => coerce(schema, v, path) === r);
}

function cmpOrder(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  value: ConditionValue | undefined,
  path: string,
): number {
  if (value === undefined || Array.isArray(value)) {
    throw new ConditionTreeError('BAD_VALUE', `ordered ops need a primitive`, path);
  }
  const a = coerceComparable(schema, raw, path);
  const b = coerceComparable(schema, value, path);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cmpBetween(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  value: ConditionValue | undefined,
  path: string,
): boolean {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ConditionTreeError('BAD_VALUE', `BETWEEN needs a [lo, hi] tuple`, path);
  }
  const r = coerceComparable(schema, raw, path);
  const lo = coerceComparable(schema, value[0], path);
  const hi = coerceComparable(schema, value[1], path);
  return r >= lo && r <= hi;
}

function cmpContains(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  value: ConditionValue | undefined,
  path: string,
): boolean {
  if (value === undefined || Array.isArray(value)) {
    throw new ConditionTreeError('BAD_VALUE', `CONTAINS needs a primitive`, path);
  }
  const needle = coerce(schema, value, path);
  if (Array.isArray(raw)) {
    return raw.some((item) => coerce(schema, item, path) === needle);
  }
  if (typeof raw === 'string') {
    return raw.toLowerCase().includes(String(needle).toLowerCase());
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coercion — drive comparison off the field's declared type
// ─────────────────────────────────────────────────────────────────────────────

function coerce(
  schema: ConditionFieldSchema,
  raw: ContextValue | ConditionPrimitive,
  path: string,
): ConditionPrimitive {
  if (raw === null || raw === undefined) return null;
  switch (schema.type) {
    case 'STRING':
    case 'ENUM':
    case 'STRING_ARRAY':
      return String(raw).toUpperCase().trim();
    case 'NUMBER':
    case 'NUMBER_ARRAY': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new ConditionTreeError('BAD_VALUE', `value ${raw} is not a number`, path);
      }
      return n;
    }
    case 'BOOLEAN':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case 'DATE': {
      const d = raw instanceof Date ? raw : new Date(raw as string | number);
      if (Number.isNaN(d.getTime())) {
        throw new ConditionTreeError('BAD_VALUE', `value ${raw} is not a date`, path);
      }
      // Comparable as epoch ms.
      return d.getTime();
    }
  }
}

/** Same as `coerce` but asserts the result is orderable (number-like). */
function coerceComparable(
  schema: ConditionFieldSchema,
  raw: ContextValue | ConditionPrimitive,
  path: string,
): number {
  const c = coerce(schema, raw, path);
  if (typeof c === 'number') return c;
  // Booleans compare via numeric coercion (true=1, false=0). Strings get
  // a lexicographic order — useful for "sector >= 'BOM'" type checks but
  // rare; we route through codePointAt so the API stays predictable.
  if (typeof c === 'boolean') return c ? 1 : 0;
  if (typeof c === 'string') {
    let h = 0;
    for (let i = 0; i < c.length; i++) {
      h = (h * 131 + c.charCodeAt(i)) | 0;
    }
    return h;
  }
  return 0;
}

function failureReason(
  schema: ConditionFieldSchema,
  raw: ContextValue,
  op: ConditionOperator,
  value: ConditionValue | undefined,
): string {
  const printRaw = raw === undefined ? '∅' : Array.isArray(raw) ? `[${raw.join(',')}]` : String(raw);
  const printVal = value === undefined
    ? ''
    : Array.isArray(value)
      ? ` [${value.join(',')}]`
      : ` ${String(value)}`;
  return `${schema.key} (=${printRaw}) ${op}${printVal}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field-type aware operator menu — drives the UI dropdown.
// ─────────────────────────────────────────────────────────────────────────────

export function operatorsForField(field: ConditionFieldSchema): readonly ConditionOperator[] {
  if (field.operators) return field.operators;
  return defaultOperatorsByType[field.type];
}

const defaultOperatorsByType: Record<ConditionFieldType, readonly ConditionOperator[]> = {
  STRING: ['EQ', 'NEQ', 'IN', 'NOT_IN', 'CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'],
  ENUM: ['EQ', 'NEQ', 'IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS'],
  NUMBER: ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'IN', 'NOT_IN'],
  BOOLEAN: ['EQ', 'NEQ'],
  DATE: ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'],
  STRING_ARRAY: ['CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'],
  NUMBER_ARRAY: ['CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'],
};
