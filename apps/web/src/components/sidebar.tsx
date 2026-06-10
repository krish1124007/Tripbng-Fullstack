'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertOctagon,
  ArrowDownToLine,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  Calendar as CalendarIcon,
  ChevronsLeft,
  ClipboardList,
  Cog,
  FileSpreadsheet,
  Gift,
  LayoutDashboard,
  Megaphone,
  Paintbrush,
  Sparkles,
  Network,
  Percent,
  Receipt,
  ShieldCheck,
  StickyNote,
  Tags,
  TreePalm,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@tripbng/shared';
import { Can } from '@/components/can';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Operations-only nav. Bookable products (Flights/Hotels/Bus/Holiday/Visa/Insurance)
// live in <ProductTabs/> at the top of the layout — not here.
const NAV: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/bookings', label: 'Bookings', icon: ClipboardList, permission: 'booking:read:own' },
      { href: '/amendments', label: 'Amendments', icon: ArrowLeftRight, permission: 'amendment:read:own' },
      { href: '/wallet', label: 'Wallet', icon: Wallet, permission: 'wallet:read:own' },
      { href: '/topups', label: 'Top-ups', icon: ArrowDownToLine, permission: 'wallet:topup:read:own' },
      { href: '/pax-book', label: 'Pax book', icon: Users },
      {
        href: '/saved-passengers',
        label: 'Saved passengers',
        icon: Users,
        permission: 'saved-passenger:read',
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/reports', label: 'Reports', icon: BarChart3, permission: 'report:run' },
      {
        href: '/admin/reports/credit-exposure',
        label: 'Credit exposure',
        icon: AlertOctagon,
        permission: 'report:platform',
      },
      {
        href: '/admin/reports/di-payouts',
        label: 'DI payouts',
        icon: Gift,
        permission: 'report:platform',
      },
      {
        href: '/admin/reports/form-26q',
        label: 'Form 26Q',
        icon: Receipt,
        permission: 'report:platform',
      },
      { href: '/audit-logs', label: 'Audit log', icon: ShieldCheck, permission: 'audit:read' },
    ],
  },
  {
    label: 'Wallet ops',
    items: [
      {
        href: '/admin/wallet-ops/adjustments',
        label: 'Adjustments',
        icon: Wallet,
        permission: 'wallet:adjust',
      },
      {
        href: '/admin/wallet-ops/transfers',
        label: 'Transfer approvals',
        icon: ArrowLeftRight,
        permission: 'wallet:adjust',
      },
      {
        href: '/admin/wallet-ops/settlements',
        label: 'Settlements',
        icon: FileSpreadsheet,
        permission: 'wallet:adjust',
      },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/inventories', label: 'Manage Inventory', icon: Boxes, permission: 'inventory:read' },
      { href: '/inventories/calendar', label: 'Calendar', icon: CalendarIcon, permission: 'inventory:read' },
      { href: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'supplier:read' },
      { href: '/markup-rules', label: 'Agency Markup', icon: Percent, permission: 'markup-rule:read' },
      { href: '/fare-rules', label: 'Manage Fare Rule', icon: Receipt, permission: 'fare-rule:read' },
      { href: '/policies', label: 'Manage Policy', icon: Tags, permission: 'policy:read' },
      {
        href: '/policies/map-policies',
        label: 'Map policies',
        icon: Tags,
        permission: 'policy:read',
      },
      {
        href: '/admin/holidays/packages',
        label: 'Holiday packages',
        icon: TreePalm,
        permission: 'holiday:author',
      },
      {
        href: '/admin/visa/products',
        label: 'Visa products',
        icon: StickyNote,
        permission: 'visa:author',
      },
    ],
  },
  {
    label: 'Network',
    items: [
      { href: '/distributors', label: 'Distributors', icon: Network, permission: 'distributor:read' },
      { href: '/agencies', label: 'Agencies', icon: Building2, permission: 'agency:read:all' },
      { href: '/agency-groups', label: 'Agency Group', icon: Building2, permission: 'agency-group:read' },
      { href: '/users', label: 'Users', icon: Users, permission: 'user:read' },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { href: '/banners', label: 'Banners', icon: Megaphone, permission: 'banner:create' },
      { href: '/updates', label: "What's new", icon: Sparkles, permission: 'update:create' },
      { href: '/incentives', label: 'Incentives', icon: Gift, permission: 'incentive:create' },
      {
        href: '/settings/branding',
        label: 'Branding',
        icon: Paintbrush,
        permission: 'branding:update:own',
      },
    ],
  },
];

// Routes where the sidebar should auto-collapse — give booking flows the full canvas.
const CANVAS_PREFIXES = ['/flights', '/hotels', '/bus', '/holidays', '/visa', '/insurance', '/search', '/book'];

export function Sidebar() {
  const pathname = usePathname();
  const [userCollapsed, setUserCollapsed] = useState(false);

  // Mode-aware: auto-collapse on canvas (product/booking) routes, expand on operations.
  // The user's explicit toggle wins on operations routes; canvas routes always force collapse.
  const inCanvasMode = CANVAS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const collapsed = inCanvasMode || userCollapsed;

  useEffect(() => {
    const stored = window.localStorage.getItem('tripbng:sidebar-collapsed');
    if (stored === '1') setUserCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('tripbng:sidebar-collapsed', userCollapsed ? '1' : '0');
  }, [userCollapsed]);

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-surface-1 transition-[width] duration-normal ease-out lg:flex',
        collapsed ? 'w-[72px]' : 'w-[252px]',
      )}
    >
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group, gi) => (
          <div key={group.label} className={cn(gi !== 0 && 'mt-5')}>
            {!collapsed ? (
              <p className="eyebrow mb-2 px-3 text-ink-4">{group.label}</p>
            ) : gi !== 0 ? (
              <hr className="mx-3 mb-3 border-strong/40" />
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t p-3">
        <NavLink
          item={{ href: '/settings', label: 'Settings', icon: Cog }}
          pathname={pathname}
          collapsed={collapsed}
        />
        {/* Hide collapse toggle when canvas-mode forces it — manual toggle would conflict */}
        {!inCanvasMode ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUserCollapsed((v) => !v)}
            className={cn(
              'mt-1 h-8 w-full justify-start text-xs text-ink-3',
              collapsed && 'justify-center',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronsLeft
              className={cn('h-4 w-4 transition-transform duration-normal', collapsed && 'rotate-180')}
            />
            {!collapsed ? <span>Collapse</span> : null}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active =
    pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
  const inner = (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast',
        active
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'text-ink-2 hover:bg-surface-2 hover:text-ink-1',
        collapsed && 'justify-center px-0',
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r-full bg-brand-600 dark:bg-brand-400"
        />
      ) : null}
      <item.icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-3 group-hover:text-ink-1',
        )}
        strokeWidth={1.75}
      />
      {!collapsed ? (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge ? (
            <span className="rounded-full bg-accent-50 px-1.5 text-[10px] font-semibold text-accent-700">
              {item.badge}
            </span>
          ) : null}
        </>
      ) : null}
    </Link>
  );
  return item.permission ? (
    <li>
      <Can permission={item.permission}>{inner}</Can>
    </li>
  ) : (
    <li>{inner}</li>
  );
}
