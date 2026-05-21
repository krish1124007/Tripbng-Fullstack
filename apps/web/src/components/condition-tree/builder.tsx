'use client';

// ConditionTreeBuilder — reusable React editor for the @tripbng/shared
// `ConditionNode` shape.
//
// Generic: the parent passes a `FieldSchema[]` describing which fields
// this rule type exposes. The builder renders:
//   • a "+ Condition" button to add a leaf, "+ Group" for an AND / OR
//   • drag-free nested rows for AND / OR / NOT groups
//   • per-leaf field picker, operator dropdown (contextual), value input
//
// Why no drag-drop?
//   The forms this lives in are admin power-user tools — operators are
//   comfortable with click-to-add + delete. Reordering is rare and can
//   be done by editing the JSON directly via the "view source" toggle.
//   Dropping drag-drop also keeps the dependency footprint tight.
//
// Round-trip invariant:
//   Every mount of the same `value` produces a structurally identical
//   tree on `onChange`. We don't mutate `value` in place — every change
//   returns a freshly-built tree, so React's referential equality + the
//   parent's `useMemo` checks behave predictably.

import { useMemo } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import {
  defaultOperatorsForType,
  isGroup,
  leaf as makeLeaf,
  type ConditionFieldSchema,
  type ConditionGroup,
  type ConditionLeaf,
  type ConditionNode,
  type ConditionOperator,
  type ConditionValue,
} from '@tripbng/shared';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface BuilderProps {
  /** Current tree value. Pass `null` to render an empty AND group. */
  value: ConditionNode | null;
  onChange: (next: ConditionNode) => void;
  schema: readonly ConditionFieldSchema[];
  /** Hide the top-level group's add buttons (useful when the parent
   *  composes multiple builders). Default false. */
  readOnly?: boolean;
  className?: string;
}

export function ConditionTreeBuilder({
  value,
  onChange,
  schema,
  readOnly,
  className,
}: BuilderProps) {
  // Empty value mounts as `AND of nothing` so the first leaf the user
  // adds doesn't need extra wrapping.
  const tree = useMemo<ConditionGroup>(() => {
    if (value && isGroup(value)) return value;
    if (value) return { type: 'AND', children: [value] };
    return { type: 'AND', children: [] };
  }, [value]);

  return (
    <div
      className={cn(
        'rounded-md border border-strong/60 bg-surface-1 p-3',
        className,
      )}
    >
      <GroupEditor
        node={tree}
        schema={schema}
        readOnly={!!readOnly}
        onChange={onChange}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Group editor — AND / OR / NOT
// ─────────────────────────────────────────────────────────────────────────────

function GroupEditor({
  node,
  schema,
  readOnly,
  onChange,
}: {
  node: ConditionGroup;
  schema: readonly ConditionFieldSchema[];
  readOnly: boolean;
  onChange: (next: ConditionNode) => void;
}) {
  const replace = (idx: number, next: ConditionNode | null): void => {
    const children = next === null
      ? node.children.filter((_, i) => i !== idx)
      : node.children.map((c, i) => (i === idx ? next : c));
    onChange({ ...node, children });
  };

  const addLeaf = (): void => {
    const first = schema[0];
    if (!first) return;
    const ops = first.operators ?? defaultOperatorsForType(first.type);
    onChange({
      ...node,
      children: [...node.children, makeLeaf(first.key, ops[0]!, defaultValueFor(first))],
    });
  };

  const addGroup = (type: 'AND' | 'OR'): void => {
    onChange({
      ...node,
      children: [...node.children, { type, children: [] }],
    });
  };

  const changeGroupType = (type: 'AND' | 'OR' | 'NOT'): void => {
    // Switching from a multi-child AND/OR to NOT collapses to a single
    // wrapped AND so the NOT-single-child invariant holds.
    if (type === 'NOT') {
      const inner: ConditionGroup =
        node.children.length === 1 && isGroup(node.children[0]!)
          ? (node.children[0] as ConditionGroup)
          : { type: 'AND', children: node.children };
      onChange({ type: 'NOT', children: [inner] });
      return;
    }
    onChange({ type, children: node.children });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <GroupTypeSelect value={node.type} onChange={changeGroupType} disabled={readOnly} />
        <span className="text-[10px] text-ink-3">
          {node.type === 'NOT'
            ? 'inverts its single child'
            : `${node.children.length} ${node.children.length === 1 ? 'condition' : 'conditions'}`}
        </span>
      </div>

      {node.children.length === 0 ? (
        <p className="rounded-md border border-dashed border-strong/60 px-3 py-2 text-xs text-ink-3">
          No conditions yet — add one with the buttons below.
        </p>
      ) : (
        <ul className="space-y-2 border-l-2 border-brand-200 pl-3 dark:border-brand-500/30">
          {node.children.map((child, idx) => (
            <li key={idx}>
              {isGroup(child) ? (
                <div className="rounded-md border border-strong/60 bg-surface-2/40 p-2">
                  <div className="mb-2 flex justify-end">
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => replace(idx, null)}
                        className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-danger/10 hover:text-danger"
                        aria-label="Remove group"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <GroupEditor
                    node={child}
                    schema={schema}
                    readOnly={readOnly}
                    onChange={(next) => replace(idx, next)}
                  />
                </div>
              ) : (
                <LeafEditor
                  node={child}
                  schema={schema}
                  readOnly={readOnly}
                  onChange={(next) => replace(idx, next)}
                  onRemove={() => replace(idx, null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && node.type !== 'NOT' ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="soft" size="xs" onClick={addLeaf}>
            <Plus className="h-3 w-3" /> Condition
          </Button>
          <Button variant="ghost" size="xs" onClick={() => addGroup('AND')}>
            <Plus className="h-3 w-3" /> AND group
          </Button>
          <Button variant="ghost" size="xs" onClick={() => addGroup('OR')}>
            <Plus className="h-3 w-3" /> OR group
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function GroupTypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: 'AND' | 'OR' | 'NOT';
  onChange: (next: 'AND' | 'OR' | 'NOT') => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value as 'AND' | 'OR' | 'NOT')}
        className={cn(
          'h-7 appearance-none rounded border border-strong bg-surface-1 px-2 pr-6 text-xs font-bold uppercase tracking-wider transition-colors',
          value === 'AND' && 'text-brand-700 dark:text-brand-300',
          value === 'OR' && 'text-accent-700',
          value === 'NOT' && 'text-warning',
        )}
      >
        <option value="AND">AND</option>
        <option value="OR">OR</option>
        <option value="NOT">NOT</option>
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 top-1.5 h-3 w-3 text-ink-3"
        strokeWidth={2}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leaf editor
// ─────────────────────────────────────────────────────────────────────────────

function LeafEditor({
  node,
  schema,
  readOnly,
  onChange,
  onRemove,
}: {
  node: ConditionLeaf;
  schema: readonly ConditionFieldSchema[];
  readOnly: boolean;
  onChange: (next: ConditionLeaf) => void;
  onRemove: () => void;
}) {
  const field = useMemo(
    () => schema.find((s) => s.key === node.field),
    [schema, node.field],
  );
  const ops = useMemo(() => {
    if (!field) return [];
    return field.operators ?? defaultOperatorsForType(field.type);
  }, [field]);

  if (!field) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
        Unknown field <code className="font-mono">{node.field}</code> — drop this row to clean up.
      </div>
    );
  }

  const changeField = (nextKey: string): void => {
    const next = schema.find((s) => s.key === nextKey);
    if (!next) return;
    const nextOps = next.operators ?? defaultOperatorsForType(next.type);
    onChange(makeLeaf(next.key, nextOps[0]!, defaultValueFor(next)));
  };

  const changeOp = (nextOp: ConditionOperator): void => {
    onChange({
      ...node,
      op: nextOp,
      // EXISTS/NOT_EXISTS drop the value; BETWEEN seeds a [0,0] tuple;
      // IN/NOT_IN seed an empty array; everything else keeps the prior
      // primitive when type-compatible, else seeds the field's default.
      value: rebaseValue(field, nextOp, node.value),
    });
  };

  const changeValue = (next: ConditionValue | undefined): void => {
    onChange(next === undefined ? { type: 'LEAF', field: node.field, op: node.op } : { ...node, value: next });
  };

  const needsValue = node.op !== 'EXISTS' && node.op !== 'NOT_EXISTS';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-strong/60 bg-surface-1 px-2 py-2">
      <select
        value={node.field}
        onChange={(e) => changeField(e.target.value)}
        disabled={readOnly}
        className="h-7 min-w-[140px] rounded border border-strong bg-surface-1 px-2 text-xs text-ink-1"
      >
        {schema.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        value={node.op}
        onChange={(e) => changeOp(e.target.value as ConditionOperator)}
        disabled={readOnly}
        className="h-7 rounded border border-strong bg-surface-1 px-2 text-xs text-ink-2"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {OP_LABEL[op]}
          </option>
        ))}
      </select>

      {needsValue ? (
        <ValueInput
          field={field}
          op={node.op}
          value={node.value}
          onChange={changeValue}
          readOnly={readOnly}
        />
      ) : null}

      {!readOnly ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-danger/10 hover:text-danger"
          aria-label="Remove condition"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const OP_LABEL: Record<ConditionOperator, string> = {
  EQ: '=',
  NEQ: '≠',
  IN: 'in',
  NOT_IN: 'not in',
  GTE: '≥',
  GT: '>',
  LTE: '≤',
  LT: '<',
  BETWEEN: 'between',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not contains',
  EXISTS: 'is set',
  NOT_EXISTS: 'is empty',
};

// ─────────────────────────────────────────────────────────────────────────────
// Value input — varies by (field type, operator)
// ─────────────────────────────────────────────────────────────────────────────

function ValueInput({
  field,
  op,
  value,
  onChange,
  readOnly,
}: {
  field: ConditionFieldSchema;
  op: ConditionOperator;
  value: ConditionValue | undefined;
  onChange: (next: ConditionValue | undefined) => void;
  readOnly: boolean;
}) {
  const inputClass =
    'h-7 min-w-[120px] rounded border border-strong bg-surface-1 px-2 text-xs text-ink-1';

  // BETWEEN — two inputs.
  if (op === 'BETWEEN') {
    const tuple = Array.isArray(value) && value.length === 2 ? value : [0, 0];
    return (
      <div className="flex items-center gap-1.5">
        <PrimitiveInput
          field={field}
          value={tuple[0]}
          onChange={(v) => onChange([v, tuple[1]] as ConditionValue)}
          readOnly={readOnly}
        />
        <span className="text-xs text-ink-3">and</span>
        <PrimitiveInput
          field={field}
          value={tuple[1]}
          onChange={(v) => onChange([tuple[0], v] as ConditionValue)}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // IN / NOT_IN — comma-separated multi-value input.
  if (op === 'IN' || op === 'NOT_IN') {
    const list = Array.isArray(value)
      ? (value as Array<string | number>).join(', ')
      : '';
    return (
      <input
        type="text"
        value={list}
        readOnly={readOnly}
        placeholder="comma, separated, values"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => coerceForField(field, s)) as ConditionValue,
          )
        }
        className={inputClass}
      />
    );
  }

  return (
    <PrimitiveInput
      field={field}
      value={Array.isArray(value) ? value[0] ?? null : value ?? null}
      onChange={(v) => onChange(v)}
      readOnly={readOnly}
    />
  );
}

function PrimitiveInput({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: ConditionFieldSchema;
  value: string | number | boolean | null | undefined;
  onChange: (next: string | number | boolean | null) => void;
  readOnly: boolean;
}) {
  const inputClass =
    'h-7 min-w-[120px] rounded border border-strong bg-surface-1 px-2 text-xs text-ink-1';

  if (field.type === 'ENUM' && field.options) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        className={inputClass}
      >
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'BOOLEAN') {
    return (
      <select
        value={value === true ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
        disabled={readOnly}
        className={inputClass}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (field.type === 'DATE') {
    const v = typeof value === 'string' ? value.slice(0, 10) : '';
    return (
      <input
        type="date"
        value={v}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClass}
      />
    );
  }
  if (field.type === 'NUMBER' || field.type === 'NUMBER_ARRAY') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputClass}
      />
    );
  }
  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default / rebase helpers
// ─────────────────────────────────────────────────────────────────────────────

function defaultValueFor(field: ConditionFieldSchema): ConditionValue {
  switch (field.type) {
    case 'NUMBER':
    case 'NUMBER_ARRAY':
      return 0;
    case 'BOOLEAN':
      return true;
    case 'DATE':
      return new Date().toISOString().slice(0, 10);
    case 'ENUM':
      return field.options?.[0]?.value ?? '';
    case 'STRING':
    case 'STRING_ARRAY':
    default:
      return '';
  }
}

function rebaseValue(
  field: ConditionFieldSchema,
  op: ConditionOperator,
  prev: ConditionValue | undefined,
): ConditionValue | undefined {
  if (op === 'EXISTS' || op === 'NOT_EXISTS') return undefined;
  if (op === 'BETWEEN') {
    const def = defaultValueFor(field);
    return [def, def] as ConditionValue;
  }
  if (op === 'IN' || op === 'NOT_IN') {
    if (Array.isArray(prev)) return prev as ConditionValue;
    return [];
  }
  if (Array.isArray(prev)) return prev[0] ?? defaultValueFor(field);
  return prev ?? defaultValueFor(field);
}

function coerceForField(field: ConditionFieldSchema, raw: string): string | number {
  if (field.type === 'NUMBER' || field.type === 'NUMBER_ARRAY') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw;
}
