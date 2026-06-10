// Phase-G tests for the ConditionTree evaluator. Pure-function tests
// (no Mongo / Redis); they cover every operator + composition + the
// coercion boundary.

import { describe, expect, it } from 'vitest';
import {
  and,
  leaf,
  not,
  or,
  type ConditionFieldSchema,
  type ConditionNode,
} from '@tripbng/shared';
import {
  ConditionTreeError,
  evaluateConditionTree,
  operatorsForField,
} from '../src/utils/condition-tree.js';

// ── Fixture schema + extractor — mirror the manual-issuance use case ──

const FIELDS: ConditionFieldSchema[] = [
  { key: 'pax_count', label: 'Pax count', type: 'NUMBER' },
  { key: 'per_pax_paise', label: 'Per-pax amount (paise)', type: 'NUMBER' },
  { key: 'sector', label: 'Sector', type: 'STRING' },
  {
    key: 'trip_type',
    label: 'Trip type',
    type: 'ENUM',
    options: [
      { value: 'ONEWAY', label: 'One way' },
      { value: 'ROUNDTRIP', label: 'Round trip' },
      { value: 'MULTICITY', label: 'Multi-city' },
    ],
  },
  { key: 'travel_date', label: 'Travel date', type: 'DATE' },
  { key: 'is_nonstop', label: 'Non-stop', type: 'BOOLEAN' },
  { key: 'agency_groups', label: 'Agency groups', type: 'STRING_ARRAY' },
];

interface Ctx {
  paxCount: number;
  perPaxPaise: number;
  sector: string;
  tripType: 'ONEWAY' | 'ROUNDTRIP' | 'MULTICITY';
  travelDate: Date;
  isNonStop: boolean;
  agencyGroups: string[];
}

const extract = (field: ConditionFieldSchema, ctx: Ctx): unknown => {
  switch (field.key) {
    case 'pax_count':
      return ctx.paxCount;
    case 'per_pax_paise':
      return ctx.perPaxPaise;
    case 'sector':
      return ctx.sector;
    case 'trip_type':
      return ctx.tripType;
    case 'travel_date':
      return ctx.travelDate;
    case 'is_nonstop':
      return ctx.isNonStop;
    case 'agency_groups':
      return ctx.agencyGroups;
    default:
      return undefined;
  }
};

const baseCtx: Ctx = {
  paxCount: 3,
  perPaxPaise: 150_000,
  sector: 'BOM-DEL',
  tripType: 'ONEWAY',
  travelDate: new Date('2026-09-15T10:00:00.000Z'),
  isNonStop: true,
  agencyGroups: ['G1', 'G2'],
};

const run = (tree: ConditionNode, ctx: Ctx = baseCtx) =>
  evaluateConditionTree(tree, ctx, {
    schema: FIELDS,
    extract: extract as (f: ConditionFieldSchema, c: Ctx) => unknown as never,
  });

// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateConditionTree — leaf operators', () => {
  it('EQ matches case-insensitively for strings', () => {
    expect(run(leaf('sector', 'EQ', 'bom-del')).matched).toBe(true);
    expect(run(leaf('sector', 'EQ', 'BOM-DEL')).matched).toBe(true);
    expect(run(leaf('sector', 'EQ', 'DEL-BOM')).matched).toBe(false);
  });

  it('NEQ is the logical inverse of EQ', () => {
    expect(run(leaf('sector', 'NEQ', 'DEL-BOM')).matched).toBe(true);
    expect(run(leaf('sector', 'NEQ', 'BOM-DEL')).matched).toBe(false);
  });

  it('IN / NOT_IN test set membership', () => {
    expect(run(leaf('sector', 'IN', ['BOM-DEL', 'DEL-BLR'])).matched).toBe(true);
    expect(run(leaf('sector', 'IN', ['DEL-BLR'])).matched).toBe(false);
    expect(run(leaf('sector', 'NOT_IN', ['DEL-BLR'])).matched).toBe(true);
  });

  it('numeric GTE / LTE coerce strings transparently', () => {
    expect(run(leaf('pax_count', 'GTE', 3)).matched).toBe(true);
    expect(run(leaf('pax_count', 'GTE', 4)).matched).toBe(false);
    // BETWEEN — both bounds inclusive.
    expect(run(leaf('per_pax_paise', 'BETWEEN', [100_000, 200_000])).matched).toBe(true);
    expect(run(leaf('per_pax_paise', 'BETWEEN', [200_000, 300_000])).matched).toBe(false);
  });

  it('DATE comparisons coerce ISO strings to comparable epoch ms', () => {
    expect(
      run(leaf('travel_date', 'GTE', '2026-09-01T00:00:00.000Z')).matched,
    ).toBe(true);
    expect(
      run(leaf('travel_date', 'GTE', '2026-10-01T00:00:00.000Z')).matched,
    ).toBe(false);
    expect(
      run(leaf('travel_date', 'BETWEEN', ['2026-01-01', '2026-12-31'])).matched,
    ).toBe(true);
  });

  it('BOOLEAN EQ coerces "true" / 1 / true to true', () => {
    expect(run(leaf('is_nonstop', 'EQ', true)).matched).toBe(true);
    expect(run(leaf('is_nonstop', 'EQ', 'true')).matched).toBe(true);
    expect(run(leaf('is_nonstop', 'EQ', false)).matched).toBe(false);
  });

  it('CONTAINS works on STRING_ARRAY', () => {
    expect(run(leaf('agency_groups', 'CONTAINS', 'G1')).matched).toBe(true);
    expect(run(leaf('agency_groups', 'CONTAINS', 'G99')).matched).toBe(false);
    expect(run(leaf('agency_groups', 'NOT_CONTAINS', 'G99')).matched).toBe(true);
  });

  it('CONTAINS works on STRING (substring)', () => {
    expect(run(leaf('sector', 'CONTAINS', 'BOM')).matched).toBe(true);
    expect(run(leaf('sector', 'CONTAINS', 'BLR')).matched).toBe(false);
  });

  it('EXISTS / NOT_EXISTS detect null / undefined / empty', () => {
    const empty: Ctx = { ...baseCtx, sector: '' };
    expect(run(leaf('sector', 'EXISTS'), empty).matched).toBe(false);
    expect(run(leaf('sector', 'NOT_EXISTS'), empty).matched).toBe(true);
    expect(run(leaf('sector', 'EXISTS')).matched).toBe(true);
  });

  it('any non-EXISTS op against a missing value yields false', () => {
    const empty: Ctx = { ...baseCtx, sector: '' };
    expect(run(leaf('sector', 'EQ', 'X'), empty).matched).toBe(false);
    expect(run(leaf('sector', 'CONTAINS', 'X'), empty).matched).toBe(false);
  });
});

describe('evaluateConditionTree — composition', () => {
  it('AND fails fast on the first false leaf', () => {
    const tree = and(
      leaf('sector', 'EQ', 'BOM-DEL'),
      leaf('pax_count', 'GTE', 10), // false
      leaf('trip_type', 'EQ', 'ONEWAY'),
    );
    const r = run(tree);
    expect(r.matched).toBe(false);
    // Trace stops at the failing leaf.
    expect(r.trace).toHaveLength(2);
    expect(r.trace[1]!.matched).toBe(false);
  });

  it('OR short-circuits at the first true leaf', () => {
    const tree = or(
      leaf('pax_count', 'GTE', 100), // false
      leaf('sector', 'EQ', 'BOM-DEL'), // true
      leaf('trip_type', 'EQ', 'X'), // never reached
    );
    const r = run(tree);
    expect(r.matched).toBe(true);
    expect(r.trace).toHaveLength(2);
  });

  it('NOT inverts its single child', () => {
    expect(run(not(leaf('sector', 'EQ', 'DEL-BLR'))).matched).toBe(true);
    expect(run(not(leaf('sector', 'EQ', 'BOM-DEL'))).matched).toBe(false);
  });

  it('handles nested AND-of-OR-of-NOT', () => {
    const tree = and(
      leaf('trip_type', 'EQ', 'ONEWAY'),
      or(leaf('sector', 'EQ', 'BOM-DEL'), leaf('sector', 'EQ', 'DEL-BLR')),
      not(leaf('pax_count', 'GTE', 10)),
    );
    expect(run(tree).matched).toBe(true);
  });

  it('empty AND is vacuously true (no constraints)', () => {
    expect(run(and()).matched).toBe(true);
  });

  it('empty OR is vacuously false (no alternatives qualified)', () => {
    expect(run(or()).matched).toBe(false);
  });
});

describe('evaluateConditionTree — error paths', () => {
  it('unknown field throws ConditionTreeError with path', () => {
    expect(() => run(leaf('not_a_field', 'EQ', 'x'))).toThrow(ConditionTreeError);
    try {
      run(leaf('not_a_field', 'EQ', 'x'));
    } catch (err) {
      expect((err as ConditionTreeError).code).toBe('UNKNOWN_FIELD');
      expect((err as ConditionTreeError).path).toBe('$');
    }
  });

  it('NOT with multiple children rejects as BAD_TREE', () => {
    const bad: ConditionNode = {
      type: 'NOT',
      children: [leaf('pax_count', 'EQ', 3), leaf('sector', 'EQ', 'BOM-DEL')],
    };
    expect(() => run(bad)).toThrow(ConditionTreeError);
  });

  it('BETWEEN with non-tuple value throws BAD_VALUE', () => {
    const bad = leaf('pax_count', 'BETWEEN', 5);
    expect(() => run(bad)).toThrow(ConditionTreeError);
  });
});

describe('operatorsForField', () => {
  it('honours the per-field override when present', () => {
    const field: ConditionFieldSchema = {
      key: 'x',
      label: 'X',
      type: 'STRING',
      operators: ['EQ', 'EXISTS'],
    };
    expect(operatorsForField(field)).toEqual(['EQ', 'EXISTS']);
  });

  it('falls back to type-default operators', () => {
    const num = FIELDS.find((f) => f.key === 'pax_count')!;
    const ops = operatorsForField(num);
    expect(ops).toContain('BETWEEN');
    expect(ops).not.toContain('CONTAINS');
  });
});
