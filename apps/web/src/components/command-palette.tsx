'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  Building2,
  ClipboardList,
  Cog,
  LayoutDashboard,
  Network,
  Plane,
  Search,
  Truck,
  Users,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import type { Permission } from '@tripbng/shared';

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  permission?: Permission;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const actions: Action[] = [
    { id: 'go-dashboard', label: 'Go to dashboard', icon: LayoutDashboard, run: () => router.push('/dashboard') },
    { id: 'go-users', label: 'Manage users', icon: Users, permission: 'user:read', run: () => router.push('/users') },
    {
      id: 'go-agencies',
      label: 'Manage agencies',
      icon: Building2,
      permission: 'agency:read:all',
      run: () => router.push('/agencies'),
    },
    {
      id: 'go-distributors',
      label: 'Manage distributors',
      icon: Network,
      permission: 'distributor:read',
      run: () => router.push('/distributors'),
    },
    {
      id: 'go-suppliers',
      label: 'Manage suppliers',
      icon: Truck,
      permission: 'supplier:read',
      run: () => router.push('/suppliers'),
    },
    {
      id: 'go-audit',
      label: 'View audit log',
      icon: ClipboardList,
      permission: 'audit:read',
      run: () => router.push('/audit-logs'),
    },
    { id: 'go-settings', label: 'Open settings', icon: Cog, run: () => router.push('/settings') },
  ];

  const visible = user
    ? actions.filter((a) => !a.permission || user.permissions.includes(a.permission))
    : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search or jump to (Cmd+K)"
        className="group flex h-9 items-center gap-2 rounded-md border bg-surface-1 px-3 text-sm text-ink-3 transition-[color,border-color,background-color] duration-fast hover:border-ink-5 hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-72"
      >
        <Search className="h-4 w-4 transition-colors group-hover:text-brand-600" strokeWidth={1.75} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="kbd hidden sm:inline">⌘K</kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-start bg-ink-1/40 backdrop-blur-[2px] pt-[10vh]"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-xl mx-auto rounded-lg border bg-surface-1 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <Command label="Command palette" className="flex flex-col">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="h-4 w-4 text-ink-3" />
                <Command.Input
                  autoFocus
                  placeholder="Search actions, pages…"
                  className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-ink-3"
                />
                <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                  esc
                </kbd>
              </div>
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">
                  No matches.
                </Command.Empty>
                <Command.Group heading="Navigate">
                  {visible.map((a) => (
                    <Command.Item
                      key={a.id}
                      value={a.label}
                      onSelect={() => {
                        a.run();
                        setOpen(false);
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink-1"
                    >
                      <a.icon className="h-4 w-4" />
                      <span>{a.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="System">
                  <Command.Item
                    value="Sign out"
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink-1"
                    onSelect={() => {
                      setOpen(false);
                      router.push('/login');
                    }}
                  >
                    <Plane className="h-4 w-4" />
                    <span>Sign out</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  );
}
