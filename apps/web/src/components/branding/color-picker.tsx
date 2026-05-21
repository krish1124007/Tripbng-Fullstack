'use client';

// ColorPicker — 8 curated presets + a free-form hex input + the
// platform's native colour-wheel popover (input[type=color]). The
// brief asked for react-colorful, which isn't installed; the native
// picker handles the same job for B2B settings and stays dep-free.

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  label: string;
  value: string;
  presets: readonly string[];
  onChange: (hex: string) => void;
  hint?: string;
}

const isHex = (s: string) =>
  /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/.test(s.trim());

export function ColorPicker({ label, value, presets, onChange, hint }: ColorPickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-semibold text-ink-1">{label}</label>
        {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
      </div>

      {/* Presets row + native colour wheel */}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => {
          const active = preset.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              aria-label={`Pick ${preset}`}
              className={cn(
                'relative h-8 w-8 rounded-md border-2 transition-all duration-fast',
                active
                  ? 'border-ink-1 ring-2 ring-brand-300/50 ring-offset-1'
                  : 'border-transparent hover:border-ink-3',
              )}
              style={{ background: preset }}
            >
              {active ? (
                <Check className="absolute inset-0 m-auto h-4 w-4 drop-shadow-sm" />
              ) : null}
            </button>
          );
        })}
        <input
          type="color"
          value={isHex(value) ? value.slice(0, 7) : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom colour"
          className="h-8 w-10 cursor-pointer rounded-md border bg-surface-1"
        />
      </div>

      {/* Free-form hex + live swatch */}
      <div className="flex items-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border"
          style={{ background: isHex(value) ? value : 'transparent' }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={cn(
            'h-8 flex-1 rounded-md border bg-surface-1 px-2 font-mono text-xs text-ink-1 outline-none transition-colors',
            isHex(value)
              ? 'border-strong focus:border-brand-500'
              : 'border-danger/60 focus:border-danger',
          )}
          placeholder="#0f62fe"
        />
      </div>
    </div>
  );
}
