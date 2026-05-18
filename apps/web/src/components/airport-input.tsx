'use client';

import { useEffect, useRef, useState } from 'react';
import { Plane, X } from 'lucide-react';
import type { Airport } from '@tripbng/shared';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/lib/api-client';
import { Input } from '@/components/ui/input';

// AirportInput — IATA-aware autocomplete. Accepts free-form text and surfaces a dropdown of
// matches keyed off the API's /airports endpoint. Pasting a code like "BOM" or "BOM-DEL"
// resolves the first leg directly. The selected Airport is propagated up via onChange.
export function AirportInput({
  value,
  onChange,
  placeholder,
  id,
  autoFocus,
  onPasteSector,
}: {
  value: Airport | null;
  onChange: (next: Airport | null) => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  // When the user pastes "BOM-DEL", the parent can wire this to populate both legs.
  onPasteSector?: (origin: string, destination: string) => void;
}) {
  const [text, setText] = useState(value ? `${value.iata} · ${value.city}` : '');
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track whether the user is actively editing (prevents the value→text
  // useEffect below from clobbering in-progress input). We flip this on
  // focus / first keystroke and off on blur or when a selection happens.
  const editingRef = useRef(false);

  // The query string sent to /airports. While the user is editing, this is
  // the raw text. Once they've selected (value set + not editing), the
  // dropdown is closed anyway, so the query is gated by `enabled`.
  const queryText = text.trim();
  const list = useApiQuery<Airport[]>(
    ['airports', queryText],
    '/api/v1/airports',
    {
      query: { q: queryText, limit: 8 },
      // Fire whenever the user has typed at least one char — even if a
      // value is already selected. (Selecting a different airport requires
      // typing on top of the current display string; we want suggestions
      // to flow during that overwrite.)
      enabled: queryText.length > 0 && open,
      staleTime: 60_000,
    },
  );
  const items = list.data ?? [];

  useEffect(() => {
    // Re-format the input text when the parent's value changes — but ONLY
    // if the user isn't mid-edit. Without this guard, every value change
    // (incl. seed re-applies on parent) would clobber the user's typed
    // characters and the input feels frozen.
    if (editingRef.current) return;
    setText(value ? `${value.iata} · ${value.city}` : '');
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (a: Airport) => {
    editingRef.current = false;
    onChange(a);
    setText(`${a.iata} · ${a.city}`);
    setOpen(false);
  };

  const clear = () => {
    editingRef.current = false;
    onChange(null);
    setText('');
    setOpen(true);
    inputRef.current?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim().toUpperCase();
    const m = pasted.match(/^([A-Z]{3})\s*[-/→\s]\s*([A-Z]{3})$/);
    if (m && onPasteSector) {
      e.preventDefault();
      onPasteSector(m[1]!, m[2]!);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        ref={inputRef}
        autoFocus={autoFocus}
        autoComplete="off"
        value={text}
        placeholder={placeholder ?? 'City or IATA code'}
        onChange={(e) => {
          editingRef.current = true;
          setText(e.target.value);
          setOpen(true);
          // Clear the parent value so the user's typed text isn't overwritten
          // by the value→text useEffect when the parent re-renders.
          if (value) onChange(null);
        }}
        onFocus={(e) => {
          // Select-all on focus so the user can immediately type to overwrite
          // the seeded "BOM · MUMBAI" instead of having to delete it first.
          editingRef.current = true;
          e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => {
          // Defer so click on a dropdown row registers before we close.
          setTimeout(() => {
            editingRef.current = false;
          }, 150);
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHover((h) => Math.min(items.length - 1, h + 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHover((h) => Math.max(0, h - 1));
          }
          if (e.key === 'Enter' && open && items[hover]) {
            e.preventDefault();
            select(items[hover]!);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        className="font-mono uppercase pr-8"
      />
      {value || text.length > 0 ? (
        <button
          type="button"
          aria-label="Clear airport"
          onMouseDown={(e) => {
            // mouseDown so the button fires before input.onBlur clears the editing flag.
            e.preventDefault();
            clear();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink-1"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}
      {open && items.length > 0 ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border bg-surface-1 shadow-elevated">
          {items.map((a, i) => (
            <button
              key={a.iata}
              type="button"
              onClick={() => select(a)}
              onMouseEnter={() => setHover(i)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                i === hover ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              <Plane className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono text-xs">{a.iata}</span>
              <span className="flex-1">
                <span className="block text-ink-1">{a.city}</span>
                <span className="block text-xs text-ink-3">{a.name}</span>
              </span>
              <span className="text-xs text-ink-3">{a.country}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
