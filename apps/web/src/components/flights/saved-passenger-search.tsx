'use client';

// SavedPassengerSearch — autocomplete-style lookup over the per-agency
// passenger directory.
//
// Sits at the top of each passenger card. The agent types a name and
// picks a saved entry from the dropdown to autofill title / first name
// / last name / DOB / passport on the current passenger row. The
// "Save passenger" checkbox on the same row decides whether the row's
// post-submit data should be persisted back to the directory.
//
// We use a 300ms debounced /api/v1/saved-passengers?q= call and cache
// the response via TanStack Query (keyed on the query string). With
// staleTime=30s the dropdown stays snappy when the agent flips back
// to the same query without re-typing.

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, User as UserIcon, X } from 'lucide-react';
import type { PublicSavedPassenger, SavedPassengerListResponse } from '@tripbng/shared';
import { useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface SavedPassengerSearchProps {
  /** Restrict suggestions to this pax type (so an adult row doesn't autofill from a child). */
  paxType: 'ADULT' | 'CHILD' | 'INFANT';
  /** Called when the agent picks a saved passenger. */
  onPick: (p: PublicSavedPassenger) => void;
}

export function SavedPassengerSearch({ paxType, onPick }: SavedPassengerSearchProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce — keep the API quiet while the agent is still typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const enabled = open && debounced.length > 0;

  const list = useApiQuery<SavedPassengerListResponse>(
    ['saved-passengers', paxType, debounced],
    '/api/v1/saved-passengers',
    {
      query: { q: debounced, type: paxType },
      enabled,
      staleTime: 30_000,
    },
  );

  const items = list.data?.items ?? [];

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
          strokeWidth={2}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search saved passengers"
          aria-label="Search saved passengers"
          className="w-full rounded-md border border-dashed border-stroke-1 bg-surface-1 py-1.5 pl-8 pr-8 text-sm text-ink-1 placeholder:text-ink-3 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        {query.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              setDebounced('');
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {/* Dropdown */}
      {open && enabled ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-stroke-1 bg-surface-1 shadow-lg">
          {list.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-ink-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Searching…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-ink-3">
              No saved {paxType.toLowerCase()}s match &quot;{debounced}&quot;
            </div>
          ) : (
            <ul role="listbox" className="max-h-60 overflow-y-auto">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(p);
                      setQuery('');
                      setDebounced('');
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 border-b border-stroke-1 px-3 py-2 text-left last:border-b-0 hover:bg-brand-50/40 dark:hover:bg-brand-500/5"
                  >
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      <UserIcon className="h-3 w-3" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-1">
                        {p.title}. {p.firstName} {p.lastName}
                      </p>
                      <p className="truncate text-[10px] text-ink-3">
                        {[
                          p.dateOfBirth ? `DOB ${p.dateOfBirth}` : null,
                          p.gender,
                          p.passport ? `Passport ${p.passport.number}` : null,
                          p.email,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'No additional details'}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ────────── SavePassengerCheckbox ──────────
//
// Tiny labelled checkbox component. Lives next to the search input so
// the agent can toggle persistence without leaving the row.

export function SavePassengerCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-brand-700 dark:text-brand-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'h-3.5 w-3.5 cursor-pointer rounded border-stroke-1 text-brand-600 transition-colors',
          'focus:ring-brand-500/30',
        )}
      />
      Save passenger
    </label>
  );
}
