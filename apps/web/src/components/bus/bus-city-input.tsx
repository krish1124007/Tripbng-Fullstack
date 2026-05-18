'use client';

// BusCityInput — autocomplete for SeatSeller cities.
//
// Mirrors the airport-input.tsx pattern but uses SeatSeller city ids
// (numeric) as the value. Type-ahead hits /api/v1/bus/cities which is
// cache-warmed by the city-sync cron.

import { useEffect, useRef, useState } from 'react';
import { Bus, X } from 'lucide-react';
import type { BusCity } from '@tripbng/shared';
import { Input } from '@/components/ui/input';
import { useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface CitiesResponse {
  cities: BusCity[];
  fromCache: boolean;
}

export function BusCityInput({
  value,
  onChange,
  placeholder,
  id,
  autoFocus,
}: {
  value: BusCity | null;
  onChange: (next: BusCity | null) => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ? value.name : '');
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks "user is mid-edit" so the value→text sync below doesn't
  // clobber characters during typing — same pattern airport-input uses.
  const editingRef = useRef(false);

  const queryText = text.trim();
  const list = useApiQuery<CitiesResponse>(
    ['bus-cities', queryText],
    '/api/v1/bus/cities',
    {
      query: { q: queryText, limit: 8 },
      enabled: queryText.length > 0 && open,
      staleTime: 60_000,
    },
  );
  const items = list.data?.cities ?? [];

  useEffect(() => {
    if (editingRef.current) return;
    setText(value ? value.name : '');
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (c: BusCity): void => {
    editingRef.current = false;
    onChange(c);
    setText(c.name);
    setOpen(false);
  };

  const clear = (): void => {
    editingRef.current = false;
    onChange(null);
    setText('');
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        ref={inputRef}
        autoFocus={autoFocus}
        autoComplete="off"
        value={text}
        placeholder={placeholder ?? 'City name'}
        onChange={(e) => {
          editingRef.current = true;
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={(e) => {
          editingRef.current = true;
          e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => {
          // Tiny defer so a click on a dropdown row registers before
          // we drop the editing flag.
          setTimeout(() => {
            editingRef.current = false;
          }, 150);
        }}
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
        className="pr-8"
      />
      {value || text.length > 0 ? (
        <button
          type="button"
          aria-label="Clear city"
          onMouseDown={(e) => {
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
          {items.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => select(c)}
              onMouseEnter={() => setHover(i)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                i === hover ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              <Bus className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                <span className="block text-ink-1">{c.name}</span>
                {c.state ? <span className="block text-xs text-ink-3">{c.state}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
