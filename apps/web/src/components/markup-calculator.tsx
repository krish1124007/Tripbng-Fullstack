'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Percent, Sparkles, X } from 'lucide-react';
import { Button, Input, Label, Separator } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'tripbng:markup-calc-defaults';

interface Defaults {
  distributorPct: string;
  agencyPct: string;
  serviceFee: string;
}

const FALLBACK_DEFAULTS: Defaults = {
  distributorPct: '2',
  agencyPct: '5',
  serviceFee: '0',
};

/**
 * MarkupCalculatorButton — sticky topbar trigger that opens a floating
 * popover. Agents check what their selling rate becomes after the markup
 * chain without leaving the current screen.
 */
export function MarkupCalculatorButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Markup calculator"
        title="Markup calculator"
        className={cn(
          'grid h-9 w-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand-600',
          open && 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
        )}
      >
        <Calculator className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-[380px] animate-slide-down rounded-xl border bg-surface-1 shadow-lg">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                <Calculator className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-1">Markup calculator</p>
                <p className="font-mono text-[10px] text-ink-3">Net → selling rate · live</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>
          <MarkupCalculator />
        </div>
      ) : null}
    </div>
  );
}

/**
 * MarkupCalculator — the body of the calculator. Stand-alone too,
 * so it can be reused on a /tools page later.
 */
export function MarkupCalculator() {
  const [defaults, setDefaults] = useState<Defaults>(FALLBACK_DEFAULTS);
  const [netRate, setNetRate] = useState('');
  const [distPct, setDistPct] = useState(FALLBACK_DEFAULTS.distributorPct);
  const [agencyPct, setAgencyPct] = useState(FALLBACK_DEFAULTS.agencyPct);
  const [serviceFee, setServiceFee] = useState(FALLBACK_DEFAULTS.serviceFee);

  // Hydrate defaults from localStorage on first paint.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Defaults;
        setDefaults(d);
        setDistPct(d.distributorPct);
        setAgencyPct(d.agencyPct);
        setServiceFee(d.serviceFee);
      }
    } catch {
      /* fail soft */
    }
  }, []);

  const breakdown = useMemo(() => {
    const net = parseFloat(netRate) || 0;
    const dPct = parseFloat(distPct) || 0;
    const aPct = parseFloat(agencyPct) || 0;
    const fee = parseFloat(serviceFee) || 0;
    const distMarkup = (net * dPct) / 100;
    const afterDist = net + distMarkup;
    const agencyMarkup = (afterDist * aPct) / 100;
    const afterAgency = afterDist + agencyMarkup;
    const totalMarkup = distMarkup + agencyMarkup;
    const gst = totalMarkup * 0.18;
    const sell = afterAgency + fee + gst;
    const margin = sell - net;
    const marginPct = net > 0 ? (margin / net) * 100 : 0;
    return {
      net,
      distMarkup,
      agencyMarkup,
      totalMarkup,
      fee,
      gst,
      sell,
      margin,
      marginPct,
    };
  }, [netRate, distPct, agencyPct, serviceFee]);

  const saveDefaults = () => {
    const d: Defaults = { distributorPct: distPct, agencyPct, serviceFee };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      setDefaults(d);
    } catch {
      /* fail soft */
    }
  };

  const reset = () => {
    setNetRate('');
    setDistPct(defaults.distributorPct);
    setAgencyPct(defaults.agencyPct);
    setServiceFee(defaults.serviceFee);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="netRate" className="eyebrow text-ink-3">
          Net rate (supplier price)
        </Label>
        <Input
          id="netRate"
          type="number"
          inputMode="decimal"
          value={netRate}
          onChange={(e) => setNetRate(e.target.value)}
          placeholder="e.g. 4500"
          autoFocus
          leading={<span className="text-ink-3">₹</span>}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="distPct" className="eyebrow text-ink-3">
            Distributor markup
          </Label>
          <Input
            id="distPct"
            type="number"
            inputMode="decimal"
            step="0.5"
            value={distPct}
            onChange={(e) => setDistPct(e.target.value)}
            trailing={<Percent className="h-3.5 w-3.5" />}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agencyPct" className="eyebrow text-ink-3">
            Agency markup
          </Label>
          <Input
            id="agencyPct"
            type="number"
            inputMode="decimal"
            step="0.5"
            value={agencyPct}
            onChange={(e) => setAgencyPct(e.target.value)}
            trailing={<Percent className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="serviceFee" className="eyebrow text-ink-3">
          Flat service fee (optional)
        </Label>
        <Input
          id="serviceFee"
          type="number"
          inputMode="decimal"
          value={serviceFee}
          onChange={(e) => setServiceFee(e.target.value)}
          leading={<span className="text-ink-3">₹</span>}
        />
      </div>

      <Separator />

      {/* Breakdown */}
      <div className="space-y-1.5">
        <BreakdownRow label="Net rate" value={breakdown.net} />
        <BreakdownRow
          label="Distributor markup"
          value={breakdown.distMarkup}
          sub={`${distPct}% on net`}
        />
        <BreakdownRow
          label="Agency markup"
          value={breakdown.agencyMarkup}
          sub={`${agencyPct}% on (net + distributor)`}
        />
        {breakdown.fee > 0 ? (
          <BreakdownRow label="Service fee" value={breakdown.fee} />
        ) : null}
        <BreakdownRow
          label="GST 18% on markup"
          value={breakdown.gst}
          sub="on commission only"
        />
      </div>

      <Separator />

      <div className="rounded-lg bg-gradient-to-br from-brand-50 to-surface-1 p-4 dark:from-brand-500/10">
        <p className="eyebrow text-ink-3">Selling rate to traveller</p>
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink-1">
          {formatRupees(Math.round(breakdown.sell))}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
            <Sparkles className="h-3 w-3" /> Margin {formatRupees(Math.round(breakdown.margin))} ·{' '}
            {breakdown.marginPct.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={reset} className="flex-1">
          Reset
        </Button>
        <Button variant="soft" size="sm" onClick={saveDefaults} className="flex-1">
          Save as defaults
        </Button>
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-ink-2">
        {label}
        {sub ? <span className="ml-1 text-[10px] text-ink-3">· {sub}</span> : null}
      </span>
      <span className="font-mono font-semibold tabular-nums text-ink-1">
        {formatRupees(Math.round(value))}
      </span>
    </div>
  );
}
