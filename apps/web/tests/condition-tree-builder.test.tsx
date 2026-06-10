// Phase-G tests for the ConditionTreeBuilder. Smoke-level — the
// evaluator gets the heavy unit testing in the API package; here we
// just confirm the React component mounts, calls onChange with a
// well-formed tree, and respects the readOnly flag.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConditionFieldSchema, ConditionNode } from '@tripbng/shared';
import { ConditionTreeBuilder } from '@/components/condition-tree/builder';

const SCHEMA: ConditionFieldSchema[] = [
  { key: 'pax_count', label: 'Pax count', type: 'NUMBER' },
  { key: 'sector', label: 'Sector', type: 'STRING' },
  {
    key: 'trip_type',
    label: 'Trip type',
    type: 'ENUM',
    options: [
      { value: 'ONEWAY', label: 'One way' },
      { value: 'ROUNDTRIP', label: 'Round trip' },
    ],
  },
];

describe('ConditionTreeBuilder', () => {
  it('mounts an empty tree without crashing', () => {
    render(<ConditionTreeBuilder value={null} schema={SCHEMA} onChange={() => undefined} />);
    expect(screen.getByText(/No conditions yet/i)).toBeInTheDocument();
  });

  it('adding a leaf via "+ Condition" emits an AND with one LEAF child', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(t: ConditionNode) => void>();
    render(<ConditionTreeBuilder value={null} schema={SCHEMA} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /condition/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0];
    expect(next.type).toBe('AND');
    expect((next as { children: ConditionNode[] }).children).toHaveLength(1);
    const first = (next as { children: ConditionNode[] }).children[0]!;
    expect(first.type).toBe('LEAF');
    expect((first as { field: string }).field).toBe('pax_count');
  });

  it('renders a leaf with field + operator dropdowns when given a populated tree', () => {
    const tree: ConditionNode = {
      type: 'AND',
      children: [{ type: 'LEAF', field: 'sector', op: 'EQ', value: 'BOM-DEL' }],
    };
    render(
      <ConditionTreeBuilder value={tree} schema={SCHEMA} onChange={() => undefined} />,
    );
    // Field picker shows the human-label of the chosen field.
    expect(screen.getByDisplayValue('Sector')).toBeInTheDocument();
    // Operator picker shows the "=" label.
    expect(screen.getByDisplayValue('=')).toBeInTheDocument();
    // Value input carries the current value.
    expect(screen.getByDisplayValue('BOM-DEL')).toBeInTheDocument();
  });

  it('flags an unknown-field leaf rather than crashing', () => {
    const tree: ConditionNode = {
      type: 'AND',
      children: [{ type: 'LEAF', field: 'not_a_real_field', op: 'EQ', value: 'x' }],
    };
    render(
      <ConditionTreeBuilder value={tree} schema={SCHEMA} onChange={() => undefined} />,
    );
    expect(screen.getByText(/Unknown field/i)).toBeInTheDocument();
  });

  it('readOnly hides the add buttons', () => {
    render(
      <ConditionTreeBuilder value={null} schema={SCHEMA} onChange={() => undefined} readOnly />,
    );
    expect(screen.queryByRole('button', { name: /condition/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /and group/i })).not.toBeInTheDocument();
  });
});
