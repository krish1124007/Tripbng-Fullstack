'use client';

// BrandingPreview — sticky mini portal mockup that paints with the
// in-progress branding values from the settings form. Renders a
// fake topbar + sidebar + page card + primary CTA so users see
// exactly how their colours look on real chrome before they save.

import { LayoutDashboard, Plane, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrandingPreviewProps {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  primaryHoverColor: string;
  primaryForegroundColor: string;
  secondaryColor: string;
}

export function BrandingPreview(props: BrandingPreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-surface-1 shadow-sm">
      {/* Topbar */}
      <div className="flex h-12 items-center justify-between border-b bg-surface-2/40 px-3">
        <div className="flex items-center gap-2">
          {props.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.logoUrl}
              alt=""
              className="h-6 w-auto max-w-[120px] object-contain"
            />
          ) : (
            <span
              className="grid h-6 w-6 place-items-center rounded font-mono text-xs font-bold"
              style={{
                background: props.primaryColor,
                color: props.primaryForegroundColor,
              }}
            >
              {props.companyName.slice(0, 1) || 'T'}
            </span>
          )}
          <span className="text-xs font-semibold text-ink-1">
            {props.companyName || 'Your Company'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-4" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink-4" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink-4" />
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex">
        <aside className="w-32 border-r bg-surface-2/30 p-2">
          <SidebarItem
            icon={<LayoutDashboard className="h-3 w-3" />}
            label="Dashboard"
            active
            primaryColor={props.primaryColor}
            primaryForegroundColor={props.primaryForegroundColor}
          />
          <SidebarItem
            icon={<Plane className="h-3 w-3" />}
            label="Bookings"
          />
          <SidebarItem icon={<Wallet className="h-3 w-3" />} label="Wallet" />
        </aside>

        <div className="flex-1 space-y-3 p-4">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-wider text-ink-3">
              Operate
            </p>
            <h4 className="mt-0.5 text-sm font-bold text-ink-1">
              Welcome back, agent.
            </h4>
          </div>

          {/* Card with primary CTA */}
          <div className="rounded-md border bg-surface-2/40 p-3">
            <p className="text-[10px] text-ink-3">A new flight just landed.</p>
            <button
              type="button"
              className="mt-2 inline-flex h-7 items-center gap-1 rounded-md px-3 text-[10px] font-semibold transition-colors"
              style={{
                background: props.primaryColor,
                color: props.primaryForegroundColor,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = props.primaryHoverColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = props.primaryColor;
              }}
            >
              Book now →
            </button>
          </div>

          {/* Secondary accent chip */}
          <div className="flex items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
              style={{ background: props.secondaryColor }}
            >
              Confirmed
            </span>
            <span className="text-[10px] text-ink-3">Status pill uses Secondary.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  primaryColor,
  primaryForegroundColor,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  primaryColor?: string;
  primaryForegroundColor?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-medium',
        !active && 'text-ink-3',
      )}
      style={
        active
          ? {
              background: primaryColor,
              color: primaryForegroundColor,
            }
          : undefined
      }
    >
      {icon} {label}
    </div>
  );
}
