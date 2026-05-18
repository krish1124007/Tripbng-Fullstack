'use client';

import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

// ────────── StringList ──────────
// Add-via-textarea + remove-by-X chip list. Used by Inclusions, Exclusions,
// Special Notes, Cancellation policy text. Each entry is a free-form HTML/string.

export function StringList({
  value,
  onChange,
  placeholder = 'Type and press Add…',
  multiline = true,
  emptyHint,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
  emptyHint?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...value, t]);
    setDraft('');
  };
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="flex-1 rounded-md border bg-surface-1 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        )}
        <Button type="button" onClick={add} variant="secondary" className="self-start">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed bg-surface-2/30 p-4 text-center text-xs text-ink-3">
          {emptyHint ?? 'No entries yet — add the first above.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((entry, i) => (
            <li
              key={`${i}-${entry.slice(0, 20)}`}
              className="flex items-start gap-3 rounded-md border bg-surface-1 p-3"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-50 font-mono text-[10px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                {i + 1}
              </span>
              {/* dangerouslySetInnerHTML so admin-authored HTML rich text renders. */}
              <div
                className="prose prose-sm flex-1 break-words text-sm text-ink-2 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: entry }}
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove entry ${i + 1}`}
                className="shrink-0 rounded p-1 text-ink-4 hover:bg-surface-2 hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ────────── ChipMultiSelect ──────────
// Toggleable chip set. When `freeForm` is true, also exposes an input to add
// custom values (used by Themes, Departure cities, Visa-hinted countries).

export function ChipMultiSelect({
  label,
  presets,
  value,
  onChange,
  freeForm = false,
  freeFormPlaceholder = 'Add custom value',
  uppercase = false,
}: {
  label?: string;
  presets: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  freeForm?: boolean;
  freeFormPlaceholder?: string;
  uppercase?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const has = (v: string) => value.includes(v);
  const toggle = (v: string) =>
    onChange(has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const addCustom = () => {
    const t = uppercase ? draft.trim().toUpperCase() : draft.trim();
    if (!t || has(t)) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      {label ? <p className="text-xs font-semibold text-ink-2">{label}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            className={cn(
              'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
              has(p)
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
            )}
          >
            {p}
          </button>
        ))}
        {/* Show user-added (non-preset) values as removable chips. */}
        {value
          .filter((v) => !presets.includes(v))
          .map((v) => (
            <span
              key={v}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-brand-500 bg-brand-50 px-3 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v)}
                aria-label={`Remove ${v}`}
                className="ml-0.5 grid h-4 w-4 place-items-center rounded-full text-brand-700/60 hover:bg-brand-200 hover:text-brand-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
      </div>
      {freeForm ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={freeFormPlaceholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <Button type="button" onClick={addCustom} variant="secondary">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ────────── NumberInput ──────────
// Thin wrapper over <Input type="number"> with Tailwind class control.

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const n = e.target.value === '' ? 0 : Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={className}
    />
  );
}

// ────────── HtmlField ──────────
// Textarea + small live-preview pane. Rich-text plumbing (TipTap, etc.) is
// out of scope; admins can paste HTML and see it rendered for sanity.

export function HtmlField({
  value,
  onChange,
  rows = 4,
  placeholder,
  previewLabel = 'Preview',
}: {
  value: string;
  onChange: (s: string) => void;
  rows?: number;
  placeholder?: string;
  previewLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder ?? 'HTML allowed — e.g. <strong>5★</strong> property…'}
        className="w-full rounded-md border bg-surface-1 px-3 py-2 font-mono text-xs leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value ? (
        <details className="rounded-md border bg-surface-2/30 p-3">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            {previewLabel}
          </summary>
          <div
            className="prose prose-sm mt-2 max-w-none break-words text-sm text-ink-2 dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: value }}
          />
        </details>
      ) : null}
    </div>
  );
}

// ────────── Section + RowCard helpers ──────────

export function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-surface-1 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-ink-3">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RowCard({
  index,
  onRemove,
  children,
}: {
  index: number;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-surface-2/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand-100 px-1.5 font-mono text-[10px] font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove row ${index + 1}`}
          className="inline-flex items-center gap-1 rounded p-1.5 text-xs text-ink-3 hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
