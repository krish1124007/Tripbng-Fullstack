'use client';

import { Minus, Plus } from 'lucide-react';

interface CounterProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}

export function Counter({ label, value, onChange, min, max }: CounterProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="grid h-8 w-8 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1 disabled:opacity-40"
          disabled={value <= min}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-6 text-center font-mono text-sm font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="grid h-8 w-8 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
