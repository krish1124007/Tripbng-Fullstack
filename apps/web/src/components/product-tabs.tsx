'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bus,
  Hotel,
  PlaneTakeoff,
  ShieldCheck,
  StickyNote,
  TreePalm,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

interface Product {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Routes that should also light up this tab as active (e.g. /book under Flights). */
  matchPrefixes?: string[];
}

const PRODUCTS: Product[] = [
  {
    href: '/flights',
    label: 'Flights',
    icon: PlaneTakeoff,
    matchPrefixes: ['/flights', '/search', '/book'],
  },
  { href: '/hotels', label: 'Hotels', icon: Hotel },
  { href: '/bus', label: 'Bus', icon: Bus },
  { href: '/holidays', label: 'Holiday', icon: TreePalm },
  { href: '/visa', label: 'Visa', icon: StickyNote },
  { href: '/insurance', label: 'Insurance', icon: ShieldCheck },
];

/**
 * ProductTabs — the primary product-switcher above the booking canvas.
 *
 * Design language:
 *   • Calm horizontal layout, centred on wide viewports, hidden-scrollbar
 *     overflow on narrow ones.
 *   • One active signal — a 2.5px brand-coloured underline directly under the
 *     tab. No competing pill background, no badges, no scaled icons.
 *   • Restraint on hover — colour shift only, no fills.
 *   • Sticky strip carries a subtle 1px border + frosted backdrop so it reads
 *     against any content scrolling beneath it.
 */
export function ProductTabs() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const canSearch = user?.permissions.includes('search:flights');

  if (!canSearch) return null;

  return (
    <div className="sticky top-16 z-20 border-b border-stroke-1 bg-surface-1/85 backdrop-blur-md">
      <nav
        aria-label="Booking products"
        className="mx-auto max-w-[1440px] px-4 lg:px-8"
      >
        <ul className="no-scrollbar flex items-center justify-center gap-1 overflow-x-auto">
          {PRODUCTS.map((p) => {
            const active =
              pathname === p.href ||
              (p.matchPrefixes ?? []).some(
                (pre) => pathname === pre || pathname.startsWith(pre + '/'),
              );
            const Icon = p.icon;
            return (
              <li key={p.href} className="shrink-0">
                <Link
                  href={p.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-2.5 px-5 py-4 text-sm font-medium outline-none transition-colors duration-fast',
                    'focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2',
                    active
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-ink-3 hover:text-ink-1',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-colors duration-fast',
                      active
                        ? 'text-brand-600 dark:text-brand-400'
                        : 'text-ink-3 group-hover:text-ink-2',
                    )}
                    strokeWidth={active ? 2 : 1.75}
                  />
                  <span className={cn(active && 'font-semibold tracking-tight')}>
                    {p.label}
                  </span>
                  {/* Active indicator — anchored to the strip's bottom edge so it
                      reads as part of the chrome, not a strikethrough on the text. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-x-3 bottom-0 h-[2.5px] rounded-t-full transition-all duration-fast',
                      active
                        ? 'bg-brand-600 opacity-100 dark:bg-brand-400'
                        : 'bg-brand-600/0 group-hover:bg-brand-600/30',
                    )}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
