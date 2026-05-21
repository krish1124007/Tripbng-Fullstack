// ConditionTree — generic predicate-as-data shape used by the rule engine.
//
// Motivation
// ----------
// Four models in this codebase carry rule-matching predicates:
//   • SupplierSource.manualIssuance — flat 10-field AND
//   • MarkupRule.conditions          — flat 10-field AND
//   • MapPolicy.criteria             — flat 5-field AND + per-component bit toggles
//   • (FareRule + Policy carry no predicates; they're parameterised by the above)
//
// Each model evolved its own field shape and the manual-issuance matcher
// hard-codes its own evaluator. Onboarding a new condition (e.g. "agency
// tier = GOLD") means editing every model + every form. This file ships a
// single contract that any rule type can store + the evaluator + UI can
// consume.
//
// Design
// ------
// A tree of group + leaf nodes. Group nodes (`AND` / `OR` / `NOT`) compose
// children; leaf nodes match a single field against a value using a typed
// operator. Trees are arbitrarily deep — the evaluator + UI both recurse.
//
// `NOT` is intentionally a single-child group rather than a leaf-level
// operator (`!eq`) so the tree shape stays orthogonal: any operator can be
// negated by wrapping its leaf in a NOT node. Keeps the leaf grammar
// simple.
//
// JSON shape — by example
// -----------------------
// (agency_group IN [G1, G2]) AND ( (sector = "BOM-DEL") OR (pax >= 5) )
//
//   {
//     type: 'AND',
//     children: [
//       { type: 'LEAF', field: 'agency_group', op: 'IN', value: ['G1','G2'] },
//       {
//         type: 'OR',
//         children: [
//           { type: 'LEAF', field: 'sector', op: 'EQ', value: 'BOM-DEL' },
//           { type: 'LEAF', field: 'pax_count', op: 'GTE', value: 5 },
//         ],
//       },
//     ],
//   }
//
// Storage
// -------
// Persisted as Mixed-type subdocs on Mongo. We deliberately don't enforce
// a Mongoose schema for the leaf nodes — the field set is rule-type-
// specific and we'd rather catch malformed trees at evaluation time
// (which surfaces a clear ops-side log line) than at write time
// (which would silently coerce bad data).

export type ConditionGroupType = 'AND' | 'OR' | 'NOT';

export type ConditionOperator =
  | 'EQ' // ==
  | 'NEQ' // !=
  | 'IN' // value ∈ list
  | 'NOT_IN' // value ∉ list
  | 'GTE' // ≥
  | 'GT' // >
  | 'LTE' // ≤
  | 'LT' // <
  | 'BETWEEN' // inclusive on both ends — value is [lo, hi]
  | 'CONTAINS' // string includes / array has
  | 'NOT_CONTAINS'
  | 'EXISTS' // field is non-null + non-empty
  | 'NOT_EXISTS';

/** A leaf comparing a single field against a value. */
export interface ConditionLeaf {
  type: 'LEAF';
  /** Stable, snake_case identifier from the rule type's field-schema. */
  field: string;
  op: ConditionOperator;
  /** Operator-dependent shape:
   *  - EQ / NEQ / GTE / GT / LTE / LT / CONTAINS / NOT_CONTAINS → primitive
   *  - IN / NOT_IN → array of primitives
   *  - BETWEEN → [lo, hi] (same primitive type)
   *  - EXISTS / NOT_EXISTS → omitted (or null) */
  value?: ConditionValue;
}

/** A composite of children — AND / OR / NOT. NOT has exactly one child. */
export interface ConditionGroup {
  type: ConditionGroupType;
  children: ConditionNode[];
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

/** Primitive values accepted by leaf comparisons. Dates ride as ISO strings
 *  in the tree so the JSON serialises cleanly across the API boundary. */
export type ConditionPrimitive = string | number | boolean | null;
export type ConditionValue =
  | ConditionPrimitive
  | ConditionPrimitive[]
  | [ConditionPrimitive, ConditionPrimitive]; // BETWEEN tuple

// ─────────────────────────────────────────────────────────────────────────────
// Field-schema descriptors
// ─────────────────────────────────────────────────────────────────────────────
//
// Each rule type tells the UI + evaluator which fields it exposes through
// a `FieldSchema[]`. The UI uses this to render the right operator + value
// input per field; the evaluator uses it for type coercion (e.g. parsing
// ISO date strings into Date objects before BETWEEN comparison).

export type ConditionFieldType =
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE' // ISO yyyy-mm-dd or ISO datetime
  | 'ENUM'
  | 'STRING_ARRAY' // CSV / multi-select inputs read as array
  | 'NUMBER_ARRAY';

export interface ConditionFieldSchema {
  /** Stable identifier — referenced by `ConditionLeaf.field`. */
  key: string;
  /** Human-readable label for the UI dropdown. */
  label: string;
  type: ConditionFieldType;
  /** Concrete value set for ENUM-typed fields. The UI renders these as a
   *  dropdown; the evaluator validates against this set. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Restricts which operators the UI offers for this field. When omitted
   *  the UI uses the type-default operator set
   *  (see `operatorsFor(type)` in the evaluator). */
  operators?: readonly ConditionOperator[];
  /** Optional free-form description shown next to the field picker in the
   *  builder UI. Useful when the field name isn't self-explanatory. */
  description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience builders — keep call sites readable
// ─────────────────────────────────────────────────────────────────────────────

export function and(...children: ConditionNode[]): ConditionGroup {
  return { type: 'AND', children };
}
export function or(...children: ConditionNode[]): ConditionGroup {
  return { type: 'OR', children };
}
export function not(child: ConditionNode): ConditionGroup {
  return { type: 'NOT', children: [child] };
}
export function leaf(
  field: string,
  op: ConditionOperator,
  value?: ConditionValue,
): ConditionLeaf {
  return value === undefined ? { type: 'LEAF', field, op } : { type: 'LEAF', field, op, value };
}

/** True if a node is a group (has `children`). Narrowing helper. */
export function isGroup(node: ConditionNode): node is ConditionGroup {
  return node.type === 'AND' || node.type === 'OR' || node.type === 'NOT';
}

/** Default operator menu the UI shows for a given field type. The field
 *  schema can override via `operators`. */
export function defaultOperatorsForType(type: ConditionFieldType): ConditionOperator[] {
  switch (type) {
    case 'STRING':
    case 'ENUM':
      return ['EQ', 'NEQ', 'IN', 'NOT_IN', 'CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'];
    case 'NUMBER':
      return ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'IN', 'NOT_IN'];
    case 'BOOLEAN':
      return ['EQ', 'NEQ'];
    case 'DATE':
      return ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'];
    case 'STRING_ARRAY':
    case 'NUMBER_ARRAY':
      return ['CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'];
  }
}
