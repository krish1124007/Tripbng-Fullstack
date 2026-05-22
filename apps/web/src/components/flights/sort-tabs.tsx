'use client';

// SortTabs — horizontal Sort-By bar.
//
// Replaces / complements the dropdown with a 4-column tab strip that
// mirrors how every OTA renders the sort row. Each tab:
//   • Departure  ⇄ asc / desc
//   • Duration   only asc (shorter = better — descending is rarely useful)
//   • Arrival    ⇄ asc / desc
//   • Price      ⇄ asc / desc
//
// Clicking the active tab toggles its direction. Clicking an inactive
// tab switches the sort and uses the natural default for that axis
// (ascending for time-based, ascending for price).

import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortKey } from './utils';

type TabKey = 'departure' | 'duration' | 'arrival' | 'price';

interface SortTabsProps {
  sort: SortKey;
  onChange: (sort: SortKey) => void;
}

const TABS: Array<{ key: TabKey; label: string; hasDir: boolean }> = [
  { key: 'departure', label: 'Departure', hasDir: true },
  { key: 'duration', label: 'Duration', hasDir: false },
  { key: 'arrival', label: 'Arrival', hasDir: true },
  { key: 'price', label: 'Price', hasDir: true },
];

export function SortTabs({ sort, onChange }: SortTabsProps) {
  // Decompose the SortKey into (active tab, direction).
  const { activeTab, dir } = parseSort(sort);

  function handleClick(tab: TabKey) {
    if (tab === activeTab && tab !== 'duration') {
      // Same tab → flip direction.
      onChange(composeSort(tab, dir === 'asc' ? 'desc' : 'asc'));
    } else {
      // New tab → ascending default.
      onChange(composeSort(tab, 'asc'));
    }
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-stroke-1 bg-surface-1 p-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="hidden shrink-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 sm:inline">
        Sort By
      </span>
      <div className="hidden h-5 w-px shrink-0 bg-stroke-1 sm:block" />
      {TABS.map((t) => {
        const isActive = t.key === activeTab;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => handleClick(t.key)}
            aria-pressed={isActive}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-fast',
              isActive
                ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                : 'text-ink-2 hover:bg-surface-2/60 hover:text-brand-700',
            )}
          >
            {t.label}
            {isActive && t.hasDir ? (
              dir === 'asc' ? (
                <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
              ) : (
                <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
              )
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ────────── SortKey ↔ (tab, dir) ──────────

function parseSort(s: SortKey): { activeTab: TabKey | 'recommended'; dir: 'asc' | 'desc' } {
  switch (s) {
    case 'price':
      return { activeTab: 'price', dir: 'asc' };
    case 'price_desc':
      return { activeTab: 'price', dir: 'desc' };
    case 'duration':
      return { activeTab: 'duration', dir: 'asc' };
    case 'departure_asc':
      return { activeTab: 'departure', dir: 'asc' };
    case 'departure_desc':
      return { activeTab: 'departure', dir: 'desc' };
    case 'arrival_asc':
      return { activeTab: 'arrival', dir: 'asc' };
    case 'arrival_desc':
      return { activeTab: 'arrival', dir: 'desc' };
    case 'recommended':
    default:
      return { activeTab: 'recommended', dir: 'asc' };
  }
}

function composeSort(tab: TabKey, dir: 'asc' | 'desc'): SortKey {
  if (tab === 'duration') return 'duration';
  if (tab === 'price') return dir === 'asc' ? 'price' : 'price_desc';
  if (tab === 'departure') return dir === 'asc' ? 'departure_asc' : 'departure_desc';
  // tab === 'arrival'
  return dir === 'asc' ? 'arrival_asc' : 'arrival_desc';
}
