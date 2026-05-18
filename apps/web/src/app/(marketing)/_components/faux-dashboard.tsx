'use client';

import {
  ArrowRight,
  ArrowUpRight,
  Plane,
  PlaneTakeoff,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';

/**
 * FauxDashboard — a static, on-brand simulation of the agency dashboard for the hero.
 * Built from the same tokens as the real UI so it stays in sync forever (no screenshots).
 * Pure presentational; no data fetching, no interactions.
 */
export function FauxDashboard() {
  return (
    <div className="relative w-full max-w-[640px]">
      {/* Floating accent bubble for visual interest */}
      <div
        aria-hidden
        className="absolute -right-6 -top-6 hidden h-16 w-16 rotate-12 place-items-center rounded-2xl bg-accent-500 shadow-lg ring-4 ring-white/30 lg:grid"
      >
        <PlaneTakeoff className="h-7 w-7 text-white" strokeWidth={1.75} />
      </div>

      {/* Browser chrome */}
      <div className="overflow-hidden rounded-2xl border border-white/30 bg-surface-1 shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-1.5 border-b bg-surface-2 px-4 py-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-success/60" />
          <div className="ml-3 hidden flex-1 rounded-md border bg-surface-1 px-3 py-0.5 font-mono text-[10px] text-ink-3 sm:block">
            tripbng.com / dashboard
          </div>
        </div>

        {/* Body — fake sidebar + content */}
        <div className="grid grid-cols-[60px_1fr] sm:grid-cols-[140px_1fr]">
          <div className="border-r bg-surface-1 p-2 sm:p-3">
            <div className="mb-3 hidden text-[9px] font-bold uppercase tracking-wider text-ink-4 sm:block">
              Operate
            </div>
            <div className="space-y-1">
              <FakeNav active label="Dashboard" />
              <FakeNav label="Search" />
              <FakeNav label="Bookings" />
              <FakeNav label="Wallet" />
              <FakeNav label="Reports" />
            </div>
          </div>
          <div className="space-y-3 p-3 sm:p-4">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-brand-600">
                AGENCY · AT000002
              </div>
              <div className="mt-1 text-base font-bold text-ink-1 sm:text-lg">Hello, Rajesh 👋</div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-3 gap-2">
              <FauxKpi
                tone="brand"
                icon={Wallet}
                label="Wallet"
                value="₹2.4 L"
                hint="+₹50K this week"
                delta={6.4}
              />
              <FauxKpi
                tone="default"
                icon={Plane}
                label="Bookings"
                value="142"
                hint="this month"
                delta={12.0}
              />
              <FauxKpi
                tone="accent"
                icon={TrendingUp}
                label="GMV"
                value="₹18 L"
                hint="vs last month"
                delta={8.1}
              />
            </div>

            {/* Best-of ribbon (compressed) */}
            <div className="rounded-lg border bg-surface-1 p-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold">
                <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-brand-700">
                  <Sparkles className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />
                  Cheapest
                </span>
                <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-accent-700">
                  <Zap className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />
                  Fastest
                </span>
                <span className="ml-auto rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-3">
                  3 of 28
                </span>
              </div>
              <div className="mt-2 grid grid-cols-[28px_1fr_auto] items-center gap-3">
                <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 font-mono text-[10px] font-bold text-brand-700">
                  6E
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink-1">IndiGo · 6E 354</div>
                  <div className="font-mono text-[10px] text-ink-3 tabular-nums">
                    08:25 BOM → 10:55 DEL · 2h 30m · Non-stop
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold tabular-nums text-ink-1">₹4,210</div>
                  <div className="text-[9px] text-success">5 seats left</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[28px_1fr_auto] items-center gap-3 opacity-60">
                <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 font-mono text-[10px] font-bold text-brand-700">
                  AI
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink-1">Air India · AI 805</div>
                  <div className="font-mono text-[10px] text-ink-3 tabular-nums">
                    09:00 BOM → 11:10 DEL · 2h 10m · Non-stop
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold tabular-nums text-ink-1">₹4,580</div>
                  <div className="text-[9px] text-ink-3">12 seats</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating wallet pill, bottom-left */}
      <div
        aria-hidden
        className="absolute -bottom-5 -left-5 hidden items-center gap-2 rounded-xl border bg-surface-1 px-3.5 py-2.5 shadow-lg lg:flex"
      >
        <span className="grid h-8 w-8 place-items-center rounded-md bg-success-soft text-success">
          <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
        </span>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Wallet credited
          </div>
          <div className="font-mono text-sm font-bold tabular-nums text-ink-1">+ ₹50,000</div>
        </div>
      </div>
    </div>
  );
}

function FakeNav({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] font-medium ${
        active ? 'bg-brand-50 text-brand-700' : 'text-ink-3'
      }`}
    >
      <div className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-brand-600' : 'bg-ink-5'}`} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

function FauxKpi({
  tone,
  icon: Icon,
  label,
  value,
  hint,
  delta,
}: {
  tone: 'brand' | 'accent' | 'default';
  icon: typeof Plane;
  label: string;
  value: string;
  hint: string;
  delta: number;
}) {
  const cardCls =
    tone === 'brand'
      ? 'bg-gradient-to-br from-brand-50 to-surface-1'
      : tone === 'accent'
        ? 'bg-gradient-to-br from-accent-50 to-surface-1'
        : 'bg-surface-1';
  const iconCls =
    tone === 'brand'
      ? 'bg-brand-100 text-brand-700'
      : tone === 'accent'
        ? 'bg-accent-100 text-accent-700'
        : 'bg-surface-2 text-ink-3';
  return (
    <div className={`rounded-lg border p-2.5 ${cardCls}`}>
      <div className="flex items-start justify-between">
        <div className="text-[9px] font-bold uppercase tracking-wider text-ink-3">{label}</div>
        <span className={`grid h-5 w-5 place-items-center rounded ${iconCls}`}>
          <Icon className="h-3 w-3" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-1.5 font-mono text-base font-bold tabular-nums leading-none text-ink-1">
        {value}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[9px]">
        <span className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1 py-0.5 font-mono font-semibold text-success">
          <ArrowRight className="h-2 w-2 -rotate-45" strokeWidth={3} />
          {delta.toFixed(1)}%
        </span>
        <span className="truncate text-ink-3">{hint}</span>
      </div>
    </div>
  );
}
