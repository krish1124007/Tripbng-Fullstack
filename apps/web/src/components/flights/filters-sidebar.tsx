'use client';

// FlightFiltersSidebar — the OTA-grade filter panel that wraps every
// flight-search dimension into one cohesive surface. Lives in the left
// rail on lg+ and inside a bottom-sheet drawer on smaller breakpoints.
//
// Every filter is derived from the result list, so counts + ranges +
// available airlines stay accurate as suppliers come back / errors drop
// in. The user can never get to "no flights match" through the sidebar
// alone because we never disable a row that has 0 matches — we just
// label it ("0 flights") so the user can intentionally back out.

import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Filter as FilterIcon,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Sunrise,
  Sunset,
  Users,
} from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  TIME_BUCKETS,
  activeFilterCount,
  emptyFilters,
  formatDuration,
  timeBucket,
  type FlightFilters,
  type FlightResult,
} from './utils';

interface SidebarProps {
  results: FlightResult[]; // pre-filter, so counts reflect the full set
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
  /** Used to render "₹X.XX" prices in the airline / price-range rows. */
  formatCurrency: (paise: number) => string;
}

export function FlightFiltersSidebar(props: SidebarProps) {
  const { results, filters, onChange, formatCurrency } = props;
  const count = activeFilterCount(filters);

  return (
    <aside className="space-y-3">
      <Card className="sticky top-[88px] max-h-[calc(100vh-104px)] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-white/95 px-4 py-3 backdrop-blur">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-ink-1">
            <FilterIcon className="h-4 w-4 text-brand-600" />
            Filters
            {count > 0 ? (
              <Badge variant="brand" className="font-mono">
                {count}
              </Badge>
            ) : null}
          </span>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange({ ...emptyFilters })}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              <RefreshCw className="h-3 w-3" /> Clear all
            </button>
          ) : null}
        </div>

        <div className="space-y-1 px-3 py-3">
          <PopularFilters results={results} filters={filters} onChange={onChange} />
          <Section title="Stops" defaultOpen>
            <StopsFilter results={results} filters={filters} onChange={onChange} />
          </Section>
          <Section title="Departure from origin" defaultOpen>
            <TimeBucketGrid
              selected={filters.departureBuckets}
              onChange={(s) => onChange({ ...filters, departureBuckets: s })}
              extract={(r) => r.segments[0]?.departure}
              results={results}
            />
          </Section>
          <Section title="Arrival at destination">
            <TimeBucketGrid
              selected={filters.arrivalBuckets}
              onChange={(s) => onChange({ ...filters, arrivalBuckets: s })}
              extract={(r) => r.segments[r.segments.length - 1]?.arrival}
              results={results}
            />
          </Section>
          <Section title="Price" defaultOpen>
            <PriceFilter
              results={results}
              filters={filters}
              onChange={onChange}
              formatCurrency={formatCurrency}
            />
          </Section>
          <Section title="Duration">
            <DurationFilter results={results} filters={filters} onChange={onChange} />
          </Section>
          <Section title="Airlines" defaultOpen>
            <AirlinesFilter
              results={results}
              filters={filters}
              onChange={onChange}
              formatCurrency={formatCurrency}
            />
          </Section>
          <Section title="Fare bucket" defaultOpen>
            <FareBucketFilter results={results} filters={filters} onChange={onChange} />
          </Section>
          <Section title="Commission">
            <CommissionFilter
              results={results}
              filters={filters}
              onChange={onChange}
              formatCurrency={formatCurrency}
            />
          </Section>
          <Section title="Fare type">
            <FareTypeFilter filters={filters} onChange={onChange} />
          </Section>
          <Section title="Layover airport">
            <LayoverFilter results={results} filters={filters} onChange={onChange} />
          </Section>
          <Section title="Inventory source">
            <SourceFilter results={results} filters={filters} onChange={onChange} />
          </Section>
          <Section title="Supplier">
            <SupplierFilter results={results} filters={filters} onChange={onChange} />
          </Section>
          <Section title="Seats &amp; search">
            <SeatsAndSearchFilter filters={filters} onChange={onChange} />
          </Section>
        </div>
      </Card>
    </aside>
  );
}

// ────────── Section shell (collapsible card row) ──────────

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-3 text-left text-sm font-bold text-ink-1 hover:text-brand-700"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-ink-3 transition-transform',
            open && 'rotate-180 text-brand-600',
          )}
        />
      </button>
      {open ? <div className="px-2 pb-4">{children}</div> : null}
    </div>
  );
}

// ────────── Popular filter chips (one-tap presets) ──────────

function PopularFilters({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  const nonstopCount = results.filter((r) => r.stops === 0).length;
  const refundableCount = results.filter((r) => r.refundable).length;
  const earlyCount = results.filter(
    (r) => r.segments[0]?.departure && timeBucket(r.segments[0].departure) <= 1,
  ).length;

  function togglePreset(preset: 'nonstop' | 'refundable' | 'morning') {
    const next = { ...filters };
    if (preset === 'nonstop') {
      const has = next.stops.has(0);
      next.stops = new Set(filters.stops);
      if (has) next.stops.delete(0);
      else next.stops.add(0);
    }
    if (preset === 'refundable') next.refundableOnly = !next.refundableOnly;
    if (preset === 'morning') {
      const buckets = new Set(filters.departureBuckets);
      const all = buckets.has(0) && buckets.has(1);
      if (all) {
        buckets.delete(0);
        buckets.delete(1);
      } else {
        buckets.add(0);
        buckets.add(1);
      }
      next.departureBuckets = buckets;
    }
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-1">
      <PresetChip
        label={`Non-stop · ${nonstopCount}`}
        active={filters.stops.has(0) && filters.stops.size === 1}
        onClick={() => togglePreset('nonstop')}
      />
      <PresetChip
        label={`Refundable · ${refundableCount}`}
        active={filters.refundableOnly}
        onClick={() => togglePreset('refundable')}
      />
      <PresetChip
        label={`Morning flights · ${earlyCount}`}
        active={filters.departureBuckets.has(0) && filters.departureBuckets.has(1)}
        onClick={() => togglePreset('morning')}
      />
    </div>
  );
}

function PresetChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
        active
          ? 'border-brand-400 bg-brand-50 text-brand-700'
          : 'border-strong/40 text-ink-2 hover:border-brand-300 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

// ────────── Stops ──────────

function StopsFilter({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  const counts = useMemo(() => {
    const c = { 0: 0, 1: 0, 2: 0 };
    for (const r of results) {
      const k = r.stops >= 2 ? 2 : (r.stops as 0 | 1);
      c[k as 0 | 1 | 2]++;
    }
    return c;
  }, [results]);

  const options = [
    { value: 0 as const, label: 'Non-stop' },
    { value: 1 as const, label: '1 stop' },
    { value: 2 as const, label: '2+ stops' },
  ];

  function toggle(v: 0 | 1 | 2) {
    const set = new Set(filters.stops);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange({ ...filters, stops: set });
  }

  return (
    <ul className="space-y-1">
      {options.map((opt) => (
        <li key={opt.value}>
          <CheckboxRow
            checked={filters.stops.has(opt.value)}
            onChange={() => toggle(opt.value)}
            label={opt.label}
            trailing={counts[opt.value] || 0}
          />
        </li>
      ))}
    </ul>
  );
}

// ────────── Time-bucket grid (used for both departure + arrival) ──────────

function TimeBucketGrid({
  selected,
  onChange,
  extract,
  results,
}: {
  selected: Set<0 | 1 | 2 | 3>;
  onChange: (s: Set<0 | 1 | 2 | 3>) => void;
  extract: (r: FlightResult) => string | undefined;
  results: FlightResult[];
}) {
  const counts = useMemo(() => {
    const c = [0, 0, 0, 0];
    for (const r of results) {
      const iso = extract(r);
      if (iso) c[timeBucket(iso)]!++;
    }
    return c;
  }, [results, extract]);

  const ICONS: Record<0 | 1 | 2 | 3, typeof Moon> = {
    0: Moon,
    1: Sunrise,
    2: Sun,
    3: Sunset,
  };

  function toggle(v: 0 | 1 | 2 | 3) {
    const set = new Set(selected);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange(set);
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {TIME_BUCKETS.map((b) => {
        const Icon = ICONS[b.value];
        const active = selected.has(b.value);
        return (
          <button
            key={b.value}
            type="button"
            onClick={() => toggle(b.value)}
            className={cn(
              'flex flex-col items-start rounded-md border p-2.5 text-left transition-colors',
              active
                ? 'border-brand-400 bg-brand-50/60 ring-2 ring-brand-200/60'
                : 'hover:border-brand-300 hover:bg-surface-2',
            )}
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-2 text-ink-2">
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="mt-2 text-xs font-bold text-ink-1">{b.label}</span>
            <span className="text-[10px] text-ink-3">{b.range}</span>
            <span className="mt-1 font-mono text-[10px] text-ink-4">{counts[b.value] ?? 0} flights</span>
          </button>
        );
      })}
    </div>
  );
}

// ────────── Price range ──────────

function PriceFilter({
  results,
  filters,
  onChange,
  formatCurrency,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
  formatCurrency: (paise: number) => string;
}) {
  const [domainMin, domainMax] = useMemo(() => {
    if (results.length === 0) return [0, 0];
    const prices = results.map((r) => r.totalGrossPaise);
    return [Math.min(...prices), Math.max(...prices)];
  }, [results]);

  // Current cap = either user-set ceiling or domainMax (no filter case).
  const cap =
    filters.priceRange[1] === Number.POSITIVE_INFINITY
      ? domainMax
      : Math.min(filters.priceRange[1], domainMax);
  const floor = Math.max(filters.priceRange[0], domainMin);

  function setCap(v: number) {
    onChange({ ...filters, priceRange: [floor, v >= domainMax ? Number.POSITIVE_INFINITY : v] });
  }

  if (domainMin === domainMax) {
    return (
      <p className="px-2 text-xs text-ink-3">
        Only one price in this result set — {formatCurrency(domainMin)}.
      </p>
    );
  }

  return (
    <div className="px-1">
      <p className="mb-1 flex items-center justify-between text-xs text-ink-2">
        <span className="font-mono">{formatCurrency(domainMin)}</span>
        <span className="font-mono font-bold text-brand-700">Up to {formatCurrency(cap)}</span>
      </p>
      <input
        type="range"
        min={domainMin}
        max={domainMax}
        step={Math.max(1, Math.round((domainMax - domainMin) / 100))}
        value={cap}
        onChange={(e) => setCap(parseInt(e.target.value, 10))}
        className="w-full accent-brand-600"
      />
      <p className="mt-1 text-[10px] text-ink-3">
        Range: {formatCurrency(domainMin)} – {formatCurrency(domainMax)}
      </p>
    </div>
  );
}

// ────────── Duration cap ──────────

function DurationFilter({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  const [minD, maxD] = useMemo(() => {
    if (results.length === 0) return [0, 0];
    const ds = results.map((r) => r.totalDuration);
    return [Math.min(...ds), Math.max(...ds)];
  }, [results]);

  const cap = filters.maxDurationMin === Number.POSITIVE_INFINITY ? maxD : Math.min(filters.maxDurationMin, maxD);

  if (minD === maxD) {
    return (
      <p className="px-2 text-xs text-ink-3">
        All flights are {formatDuration(minD)}.
      </p>
    );
  }

  return (
    <div className="px-1">
      <p className="mb-1 flex items-center justify-between text-xs text-ink-2">
        <span className="font-mono">{formatDuration(minD)}</span>
        <span className="font-mono font-bold text-brand-700">Up to {formatDuration(cap)}</span>
      </p>
      <input
        type="range"
        min={minD}
        max={maxD}
        step={5}
        value={cap}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange({
            ...filters,
            maxDurationMin: v >= maxD ? Number.POSITIVE_INFINITY : v,
          });
        }}
        className="w-full accent-brand-600"
      />
    </div>
  );
}

// ────────── Airlines ──────────

function AirlinesFilter({
  results,
  filters,
  onChange,
  formatCurrency,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
  formatCurrency: (paise: number) => string;
}) {
  const byAirline = useMemo(() => {
    const m = new Map<string, { name: string; count: number; minPrice: number }>();
    for (const r of results) {
      const a = r.segments[0]?.airline;
      if (!a?.code) continue;
      const prev = m.get(a.code);
      if (prev) {
        prev.count++;
        if (r.totalGrossPaise < prev.minPrice) prev.minPrice = r.totalGrossPaise;
      } else {
        m.set(a.code, { name: a.name ?? a.code, count: 1, minPrice: r.totalGrossPaise });
      }
    }
    return Array.from(m.entries())
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [results]);

  function toggle(code: string) {
    const set = new Set(filters.airlines);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onChange({ ...filters, airlines: set });
  }

  if (byAirline.length === 0) {
    return <p className="px-2 text-xs text-ink-3">No airlines yet.</p>;
  }

  return (
    <ul className="space-y-1 max-h-64 overflow-y-auto">
      {byAirline.map((a) => (
        <li key={a.code}>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-brand-600"
              checked={filters.airlines.has(a.code)}
              onChange={() => toggle(a.code)}
            />
            <span className="grid h-5 w-9 shrink-0 place-items-center rounded-sm bg-surface-2 font-mono text-[10px] font-bold text-ink-2">
              {a.code}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{a.name}</span>
            <span className="shrink-0 text-right">
              <span className="font-mono text-xs font-semibold text-ink-1">
                {formatCurrency(a.minPrice)}
              </span>
              <span className="ml-1.5 font-mono text-[10px] text-ink-4">· {a.count}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

// ────────── Fare type ──────────

function FareTypeFilter({
  filters,
  onChange,
}: {
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  return (
    <ul className="space-y-1">
      <li>
        <CheckboxRow
          checked={filters.refundableOnly}
          onChange={() => onChange({ ...filters, refundableOnly: !filters.refundableOnly })}
          label="Refundable only"
        />
      </li>
    </ul>
  );
}

// ────────── Fare bucket (MAIN / FLX / SAVR / SME / LCC) ──────────

function FareBucketFilter({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  // Inline classifier — must mirror classifyFare() / applyFlightFilters
  // in utils. Counted live against the unfiltered result set.
  const counts = useMemo(() => {
    const c = { MAIN: 0, FLX: 0, SAVR: 0, SME: 0, LCC: 0 };
    for (const r of results) {
      const fc = (r.fareClass ?? '').toUpperCase();
      let bucket: keyof typeof c = 'MAIN';
      if (/SME|CORP/.test(fc)) bucket = 'SME';
      else if (/FLEX|FLX|FLEXI|REFUND/.test(fc) || (r.refundable && r.source !== 'SERIES'))
        bucket = 'FLX';
      else if (r.source === 'SERIES' || /SAVE|SAVR|SVR/.test(fc)) bucket = 'SAVR';
      else if (r.source === 'LCC') bucket = 'LCC';
      c[bucket]++;
    }
    return c;
  }, [results]);

  const LABELS: Record<'MAIN' | 'FLX' | 'SAVR' | 'SME' | 'LCC', { label: string; hint: string }> = {
    MAIN: { label: 'Main', hint: 'Standard fare' },
    FLX: { label: 'Flex', hint: 'Refundable / changeable' },
    SAVR: { label: 'Saver', hint: 'Series / consolidator' },
    SME: { label: 'SME', hint: 'Corporate fare' },
    LCC: { label: 'LCC', hint: 'Low-cost published' },
  };

  function toggle(v: 'MAIN' | 'FLX' | 'SAVR' | 'SME' | 'LCC') {
    const set = new Set(filters.fareTypes);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange({ ...filters, fareTypes: set });
  }

  return (
    <ul className="space-y-1">
      {(['MAIN', 'FLX', 'SAVR', 'SME', 'LCC'] as const).map((b) => (
        <li key={b}>
          <CheckboxRow
            checked={filters.fareTypes.has(b)}
            onChange={() => toggle(b)}
            label={LABELS[b].label}
            sub={LABELS[b].hint}
            trailing={counts[b] || 0}
          />
        </li>
      ))}
    </ul>
  );
}

// ────────── Commission (incentive / net) ──────────

function CommissionFilter({
  results,
  filters,
  onChange,
  formatCurrency,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
  formatCurrency: (paise: number) => string;
}) {
  // Domain: only consider results with positive incentive when sizing
  // the slider (so a few "zero incentive" rows don't bury the useful
  // range at the bottom).
  const maxInc = useMemo(() => {
    let m = 0;
    for (const r of results) {
      const inc = r.totalGrossPaise - r.totalAgencyPayablePaise;
      if (inc > m) m = inc;
    }
    return m;
  }, [results]);

  const cap = Math.min(filters.minIncentivePaise, maxInc);

  return (
    <div className="space-y-3 px-1">
      <CheckboxRow
        checked={filters.positiveIncentiveOnly}
        onChange={() =>
          onChange({ ...filters, positiveIncentiveOnly: !filters.positiveIncentiveOnly })
        }
        label="Earning fares only"
        sub="Hide fares with no incentive"
      />
      {maxInc > 0 ? (
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs text-ink-2">
            <span className="font-semibold">Minimum incentive</span>
            <span className="font-mono font-bold text-brand-700">
              ≥ {formatCurrency(cap)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={maxInc}
            step={Math.max(1, Math.round(maxInc / 50))}
            value={cap}
            onChange={(e) =>
              onChange({ ...filters, minIncentivePaise: parseInt(e.target.value, 10) })
            }
            className="w-full accent-brand-600"
          />
          <p className="mt-1 text-[10px] text-ink-3">
            Up to {formatCurrency(maxInc)} per booking in this result set.
          </p>
        </label>
      ) : (
        <p className="text-xs text-ink-3">No commission data in this result set.</p>
      )}
    </div>
  );
}

// ────────── Layover airports ──────────

function LayoverFilter({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  const layovers = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      for (let i = 1; i < r.segments.length; i++) {
        const code = r.segments[i]!.origin.code;
        m.set(code, (m.get(code) ?? 0) + 1);
      }
    }
    return Array.from(m.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);
  }, [results]);

  if (layovers.length === 0) {
    return <p className="px-2 text-xs text-ink-3">All flights are non-stop in this result set.</p>;
  }

  function toggle(code: string) {
    const set = new Set(filters.layovers);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onChange({ ...filters, layovers: set });
  }

  return (
    <ul className="grid grid-cols-2 gap-1">
      {layovers.map((l) => (
        <li key={l.code}>
          <button
            type="button"
            onClick={() => toggle(l.code)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs font-semibold',
              filters.layovers.has(l.code)
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'text-ink-2 hover:border-brand-300 hover:bg-surface-2',
            )}
          >
            <span className="font-mono">{l.code}</span>
            <span className="font-mono text-[10px] text-ink-4">{l.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ────────── Source ──────────

function SourceFilter({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of results) c[r.source] = (c[r.source] ?? 0) + 1;
    return c;
  }, [results]);

  const LABELS: Record<string, { label: string; hint: string }> = {
    SERIES: { label: 'Series fares', hint: 'Charter / consolidator' },
    LCC: { label: 'LCC', hint: 'Low-cost carrier' },
    FSC: { label: 'FSC', hint: 'Full-service carrier' },
    API: { label: 'API / GDS', hint: 'Aggregator direct' },
  };

  function toggle(v: 'SERIES' | 'LCC' | 'FSC' | 'API') {
    const set = new Set(filters.sources);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange({ ...filters, sources: set });
  }

  return (
    <ul className="space-y-1">
      {(['SERIES', 'LCC', 'FSC', 'API'] as const).map((s) => (
        <li key={s}>
          <CheckboxRow
            checked={filters.sources.has(s)}
            onChange={() => toggle(s)}
            label={LABELS[s]?.label ?? s}
            sub={LABELS[s]?.hint ?? ''}
            trailing={counts[s] || 0}
          />
        </li>
      ))}
    </ul>
  );
}

// ────────── Supplier ──────────

function SupplierFilter({
  results,
  filters,
  onChange,
}: {
  results: FlightResult[];
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of results) {
      const prev = m.get(r.supplierCode);
      if (prev) prev.count++;
      else m.set(r.supplierCode, { name: r.supplierName || r.supplierCode, count: 1 });
    }
    return Array.from(m.entries())
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [results]);

  function toggle(code: string) {
    const set = new Set(filters.suppliers);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onChange({ ...filters, suppliers: set });
  }

  if (counts.length === 0) return <p className="px-2 text-xs text-ink-3">No suppliers yet.</p>;
  return (
    <ul className="space-y-1">
      {counts.map((s) => (
        <li key={s.code}>
          <CheckboxRow
            checked={filters.suppliers.has(s.code)}
            onChange={() => toggle(s.code)}
            label={s.name}
            sub={s.code}
            trailing={s.count}
          />
        </li>
      ))}
    </ul>
  );
}

// ────────── Seats + free-text query ──────────

function SeatsAndSearchFilter({
  filters,
  onChange,
}: {
  filters: FlightFilters;
  onChange: (next: FlightFilters) => void;
}) {
  return (
    <div className="space-y-3 px-1">
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <Users className="h-3.5 w-3.5" />
          Minimum seats remaining
        </span>
        <input
          type="number"
          min={0}
          max={9}
          value={filters.minSeats}
          onChange={(e) =>
            onChange({ ...filters, minSeats: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })
          }
          className="w-full rounded-md border bg-surface-1 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          placeholder="Any"
        />
      </label>
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <Search className="h-3.5 w-3.5" />
          Filter results
        </span>
        <input
          type="text"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          className="w-full rounded-md border bg-surface-1 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          placeholder="Airline name or flight number"
        />
      </label>
    </div>
  );
}

// ────────── Checkbox primitive ──────────

function CheckboxRow({
  checked,
  onChange,
  label,
  sub,
  trailing,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  sub?: string;
  trailing?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 cursor-pointer accent-brand-600"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink-1">{label}</span>
        {sub ? <span className="block text-[10px] text-ink-3">{sub}</span> : null}
      </span>
      {trailing !== undefined ? (
        <span className="shrink-0 font-mono text-[10px] text-ink-4">{trailing}</span>
      ) : null}
    </label>
  );
}
