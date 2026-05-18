'use client';

// Sticky anchor nav — left-pinned chip strip that scroll-spies the visible
// section. Each chip is an in-page anchor (#id). Used by the holiday-detail
// page to jump between Highlights / Day-by-day / Where you stay / etc.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SectionNavItem {
  id: string;
  label: string;
}

export function SectionNav({ items }: { items: readonly SectionNavItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? '');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Account for the sticky topbar + a little breathing room when computing
    // which section is "in view".
    const STICKY_OFFSET = 120;

    const handler = () => {
      let bestId = items[0]?.id ?? '';
      let bestTop = -Infinity;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - STICKY_OFFSET;
        // Pick the section whose top has crossed above the offset most recently.
        if (top <= 0 && top > bestTop) {
          bestTop = top;
          bestId = it.id;
        }
      }
      setActive(bestId);
    };

    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, [items]);

  const onJump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-0 z-20 -mx-4 border-b bg-surface-1/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6"
    >
      <ul className="flex flex-nowrap gap-1.5 overflow-x-auto">
        {items.map((it) => (
          <li key={it.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onJump(it.id)}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                it.id === active
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
              )}
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
