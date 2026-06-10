'use client';

// SavedPassengerSearch — autocomplete-style lookup over the per-agency
// passenger directory (/api/v1/saved-passengers).
//
// UX details:
//   • Open on focus — shows the most-recently-updated saved passengers
//     of the matching pax type, even before the user types. Makes the
//     directory discoverable for users who don't remember the exact
//     name. Filtered as they type (300ms debounce).
//   • Empty-state CTA — when the agency has zero saved passengers of
//     this pax type, the dropdown surfaces a "Manage directory →" link
//     to /saved-passengers instead of a silent box.
//   • Keyboard nav — ArrowDown / ArrowUp move highlight; Enter picks;
//     Escape closes. Useful for the keyboard-first booking workflow.
//   • Per-pax-type filter — adult rows pull adults, child rows pull
//     children, infant rows pull infants. Prevents wrong-type
//     autofills that produce supplier validation errors later.
//   • Network errors — when /api/v1/saved-passengers fails (401, 500,
//     offline), the dropdown shows a clear error instead of silently
//     returning empty. The search box stays usable so retry happens
//     automatically when the user types again.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, Search, User as UserIcon, X } from 'lucide-react';
import type { PublicSavedPassenger, SavedPassengerListResponse } from '@tripbng/shared';
import { useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface SavedPassengerSearchProps {
  /** Restrict suggestions to this pax type (so an adult row doesn't autofill from a child). */
  paxType: 'ADULT' | 'CHILD' | 'INFANT';
  /** Called when the agent picks a saved passenger. */
  onPick: (p: PublicSavedPassenger) => void;
}

const RECENTS_LIMIT = 8;
const PAX_LABEL: Record<'ADULT' | 'CHILD' | 'INFANT', string> = {
  ADULT: 'adult',
  CHILD: 'child',
  INFANT: 'infant',
};

export function SavedPassengerSearch({ paxType, onPick }: SavedPassengerSearchProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Fire the query whenever the dropdown is open. Empty `debounced`
  // returns the recents list (server sorts by updatedAt DESC); non-
  // empty `debounced` runs server-side search. Either way the
  // dropdown has data to show as soon as the user opens it.
  const list = useApiQuery<SavedPassengerListResponse>(
    ['saved-passengers', paxType, debounced],
    '/api/v1/saved-passengers',
    {
      query: { type: paxType, ...(debounced ? { q: debounced } : {}) },
      enabled: open,
      staleTime: 30_000,
      // Don't retry auth/permission errors — the user can't fix
      // those by waiting. Surface the message inside the dropdown so
      // they spot misconfig quickly.
      retry: false,
    },
  );

  const items = useMemo(
    () => (list.data?.items ?? []).slice(0, debounced ? 12 : RECENTS_LIMIT),
    [list.data, debounced],
  );

  // Reset highlight whenever the underlying list shape changes.
  useEffect(() => {
    setHighlight(0);
  }, [items.length]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) {
      if (e.key === 'ArrowDown' && !open) {
        setOpen(true);
        e.preventDefault();
      }
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlight((h) => (h + 1) % items.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlight((h) => (h - 1 + items.length) % items.length);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const picked = items[highlight];
      if (picked) {
        pick(picked);
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const pick = (p: PublicSavedPassenger) => {
    onPick(p);
    setQuery('');
    setDebounced('');
    setOpen(false);
  };

  // Identify auth / network errors so we can surface them in the
  // dropdown body. ApiCallError exposes `.code` (string) on the
  // error so we can distinguish a 401 from a server-side 500.
  const error = list.error as { code?: string; message?: string } | null | undefined;
  const isAuthError =
    error?.code === 'TOKEN_INVALID' || error?.code === 'FORBIDDEN';
  const hasNoEntries =
    !list.isLoading && !error && items.length === 0 && !debounced;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
          strokeWidth={2}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search saved passengers"
          aria-label="Search saved passengers"
          aria-expanded={open}
          aria-controls="saved-passenger-listbox"
          autoComplete="off"
          className="w-full rounded-md border border-dashed border-stroke-1 bg-surface-1 py-1.5 pl-8 pr-8 text-sm text-ink-1 placeholder:text-ink-3 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        {query.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              setDebounced('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {/* Dropdown — opens on focus, not just after typing. */}
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-stroke-1 bg-surface-1 shadow-lg">
          {/* Header strip — shows what kind of list we're displaying. */}
          <div className="flex items-center justify-between border-b border-stroke-1 bg-surface-2/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            <span>
              {debounced
                ? `Matches for "${debounced}"`
                : `Recent ${PAX_LABEL[paxType]}s`}
            </span>
            {list.isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <span className="font-mono">{items.length}</span>
            )}
          </div>

          {/* Body */}
          {isAuthError ? (
            <div className="flex items-start gap-2 px-3 py-3 text-[12px] text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <div>
                <p className="font-semibold">Can&apos;t reach saved-passenger directory</p>
                <p className="text-[11px] text-ink-3">
                  Your session may have expired. Refresh the page or sign in again.
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 px-3 py-3 text-[12px] text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <div>
                <p className="font-semibold">Lookup failed</p>
                <p className="text-[11px] text-ink-3">{error.message ?? 'Network error'}</p>
              </div>
            </div>
          ) : list.isLoading && items.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-ink-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Searching directory…
            </div>
          ) : items.length === 0 ? (
            hasNoEntries ? (
              <div className="space-y-1.5 px-3 py-3 text-[12px]">
                <p className="font-semibold text-ink-1">No saved {PAX_LABEL[paxType]}s yet</p>
                <p className="text-ink-3">
                  Save frequent travellers to your agency directory so the team can autofill
                  passenger details in one click.
                </p>
                <Link
                  href="/saved-passengers"
                  className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300"
                >
                  Manage directory <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="px-3 py-2.5 text-[12px] text-ink-3">
                No saved {PAX_LABEL[paxType]}s match &quot;{debounced}&quot;.{' '}
                <span className="text-ink-4">Tip: try a partial name.</span>
              </div>
            )
          ) : (
            <ul
              id="saved-passenger-listbox"
              role="listbox"
              className="max-h-72 overflow-y-auto"
            >
              {items.map((p, idx) => (
                <li key={p.id} role="option" aria-selected={highlight === idx}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(p)}
                    className={cn(
                      'flex w-full items-start gap-2.5 border-b border-stroke-1 px-3 py-2 text-left last:border-b-0 transition-colors',
                      highlight === idx
                        ? 'bg-brand-50/60 dark:bg-brand-500/10'
                        : 'hover:bg-brand-50/30 dark:hover:bg-brand-500/5',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full',
                        highlight === idx
                          ? 'bg-brand-500 text-white'
                          : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
                      )}
                    >
                      <UserIcon className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-ink-1">
                          {p.title}. {p.firstName} {p.lastName}
                        </p>
                        {p.passport?.number ? (
                          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-ink-4">
                            {p.passport.number}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-[10px] text-ink-3">
                        {[
                          p.dateOfBirth ? `DOB ${p.dateOfBirth}` : null,
                          p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : null,
                          p.email,
                          p.phone,
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

          {/* Footer hint — only when we have a list to navigate. */}
          {items.length > 0 ? (
            <div className="flex items-center justify-between border-t border-stroke-1 bg-surface-2/40 px-3 py-1.5 text-[10px] text-ink-4">
              <span>
                <kbd className="rounded border px-1 font-mono">↑↓</kbd> navigate ·{' '}
                <kbd className="rounded border px-1 font-mono">↵</kbd> pick
              </span>
              <Link
                href="/saved-passengers"
                className="text-ink-3 hover:text-brand-700 hover:underline dark:hover:text-brand-300"
              >
                Manage directory →
              </Link>
            </div>
          ) : null}
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
