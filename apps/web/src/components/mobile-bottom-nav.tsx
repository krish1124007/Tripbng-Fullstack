'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  Building,
  Bus,
  ClipboardList,
  Cog,
  Gift,
  Hotel,
  LayoutDashboard,
  Megaphone,
  MoreHorizontal,
  Network,
  Percent,
  PlaneTakeoff,
  Receipt,
  ShieldCheck,
  StickyNote,
  Tags,
  TreePalm,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@tripbng/shared';
import { Can } from '@/components/can';
import { Logo } from '@/components/logo';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
}

const ALL: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  // Booking products
  { href: '/flights', label: 'Flights', icon: PlaneTakeoff, permission: 'search:flights' },
  { href: '/hotels', label: 'Hotels', icon: Hotel },
  { href: '/bus', label: 'Bus', icon: Bus, permission: 'search:buses' },
  { href: '/holidays', label: 'Holiday', icon: TreePalm },
  { href: '/visa', label: 'Visa', icon: StickyNote },
  { href: '/insurance', label: 'Insurance', icon: ShieldCheck },
  // Operations
  { href: '/bookings', label: 'Bookings', icon: ClipboardList, permission: 'booking:read:own' },
  { href: '/amendments', label: 'Amendments', icon: ArrowLeftRight, permission: 'amendment:read:own' },
  { href: '/wallet', label: 'Wallet', icon: Wallet, permission: 'wallet:read:own' },
  { href: '/topups', label: 'Top-ups', icon: Wallet, permission: 'wallet:topup:read:own' },
  { href: '/reports', label: 'Reports', icon: BarChart3, permission: 'report:run' },
  { href: '/audit-logs', label: 'Audit log', icon: ShieldCheck, permission: 'audit:read' },
  { href: '/inventories', label: 'Inventory', icon: Boxes, permission: 'inventory:read' },
  { href: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'supplier:read' },
  { href: '/markup-rules', label: 'Markup rules', icon: Percent, permission: 'markup-rule:read' },
  { href: '/fare-rules', label: 'Fare rules', icon: Receipt, permission: 'fare-rule:read' },
  { href: '/policies', label: 'Policies', icon: Tags, permission: 'policy:read' },
  { href: '/distributors', label: 'Distributors', icon: Network, permission: 'distributor:read' },
  { href: '/agencies', label: 'Agencies', icon: Building2, permission: 'agency:read:all' },
  { href: '/agency-groups', label: 'Agency groups', icon: Building, permission: 'agency-group:read' },
  { href: '/users', label: 'Users', icon: Users, permission: 'user:read' },
  { href: '/banners', label: 'Banners', icon: Megaphone, permission: 'banner:create' },
  { href: '/incentives', label: 'Incentives', icon: Gift, permission: 'incentive:create' },
  { href: '/settings', label: 'Settings', icon: Cog },
];

const byHref = (href: string): NavItem => {
  const item = ALL.find((i) => i.href === href);
  if (!item) throw new Error(`mobile-bottom-nav: unknown href ${href}`);
  return item;
};

// Per-role primary 4 in the bottom strip — ordered by frequency-of-use.
function primaryFor(role: string | undefined): NavItem[] {
  if (role === 'SUPER_ADMIN') {
    return [
      byHref('/dashboard'),
      byHref('/agencies'),
      byHref('/reports'),
      byHref('/audit-logs'),
    ];
  }
  if (role === 'DISTRIBUTOR') {
    return [
      byHref('/dashboard'),
      byHref('/agencies'),
      byHref('/wallet'),
      byHref('/reports'),
    ];
  }
  // AGENCY / SUB_AGENT default — Flights is the most-used product for them
  return [
    byHref('/dashboard'),
    byHref('/flights'),
    byHref('/bookings'),
    byHref('/wallet'),
  ];
}

/**
 * MobileBottomNav — visible only at < lg breakpoint where the sidebar is hidden.
 * Sticks to the bottom of the viewport with safe-area padding for notch phones.
 * 4 primary items + a "More" sheet that exposes everything.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  const primary = primaryFor(user?.role);

  return (
    <>
      <nav
        aria-label="Primary"
        className="glass sticky bottom-0 z-30 -mx-6 flex items-center border-t px-2 lg:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {primary.map((item) => (
          <NavTile key={item.href} item={item} pathname={pathname} />
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-ink-3 transition-colors hover:text-ink-1"
          aria-label="More navigation"
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
          <span>More</span>
        </button>
      </nav>

      {/* Sheet — full-screen drawer with all nav items */}
      {open ? (
        <div
          className="fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-sm animate-fade-in lg:hidden"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-slide-down rounded-t-2xl border-t bg-surface-1"
            style={{ animationName: 'fade-in-up' }}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <Logo variant="full" className="h-6" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 overflow-y-auto p-4">
              {ALL.map((item) => {
                const inner = (
                  <SheetTile
                    item={item}
                    pathname={pathname}
                    onClick={() => setOpen(false)}
                  />
                );
                return item.permission ? (
                  <Can key={item.href} permission={item.permission}>
                    {inner}
                  </Can>
                ) : (
                  <div key={item.href}>{inner}</div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function NavTile({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  const inner = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
        active ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3 hover:text-ink-1',
      )}
    >
      <item.icon
        className={cn('h-5 w-5 transition-colors', active && 'text-brand-600 dark:text-brand-400')}
        strokeWidth={1.75}
      />
      <span>{item.label}</span>
    </Link>
  );
  return item.permission ? <Can permission={item.permission}>{inner}</Can> : inner;
}

function SheetTile({
  item,
  pathname,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  onClick: () => void;
}) {
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors',
        active
          ? 'border-brand-300 bg-brand-50 dark:bg-brand-500/15 dark:border-brand-500/40'
          : 'border-strong bg-surface-1 hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'grid h-9 w-9 place-items-center rounded-md',
          active
            ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/25 dark:text-brand-300'
            : 'bg-surface-2 text-ink-3',
        )}
      >
        <item.icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <span
        className={cn(
          'text-xs font-medium leading-tight',
          active ? 'text-brand-700 dark:text-brand-300' : 'text-ink-1',
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}
