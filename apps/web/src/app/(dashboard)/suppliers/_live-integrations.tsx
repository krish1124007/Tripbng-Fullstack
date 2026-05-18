'use client';

// Live-integrations dashboard — the top half of the Suppliers page.
//
// Replaces the empty Mongo-supplier table for env-driven adapters
// (Kafila, AirIQ, eTrav, TBO, SeatSeller, Asego, Mock, Series). Surfaces:
//   - effective ON/OFF state (env flag × admin override)
//   - last health snapshot (cached 30s) with "Test now" force-refresh
//   - per-integration enable/disable toggle (writes IntegrationOverride
//     and takes effect within ~30s across the API fleet)
//   - product chips so ops can answer "who serves hotels?" at a glance

import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Plane,
  Building2,
  Bus,
  TreePalm,
  StickyNote,
  ShieldCheck,
  Wifi,
  RefreshCw,
  Power,
  PowerOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@/components/ui';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// Shape mirrors apps/api/src/services/integration-status.service.ts.
// Inlined rather than imported because the shared package doesn't export
// the integration types yet (admin-side only).
interface IntegrationStatus {
  code: string;
  name: string;
  vendor: string;
  products: ('FLIGHT' | 'HOTEL' | 'BUS' | 'HOLIDAY' | 'VISA' | 'INSURANCE')[];
  toggleable: boolean;
  docs?: string;
  envEnabled: boolean;
  overrideDisabled: boolean;
  effective: 'ON' | 'OFF';
  offReason?: string;
  health: {
    ok: boolean | null;
    message?: string;
    latencyMs?: number;
    probedAt?: string;
  };
  override?: {
    note: string;
    updatedAt: string;
    updatedBy: string | null;
  };
}

const PRODUCT_ICONS = {
  FLIGHT: Plane,
  HOTEL: Building2,
  BUS: Bus,
  HOLIDAY: TreePalm,
  VISA: StickyNote,
  INSURANCE: ShieldCheck,
} as const;

export function LiveIntegrations() {
  const list = useApiQuery<IntegrationStatus[]>(
    ['suppliers', 'integrations'],
    '/api/v1/suppliers/integrations',
    { staleTime: 15_000 },
  );
  const invalidate = useInvalidateOnSuccess([['suppliers', 'integrations']]);

  const testing = useApiMutation<{ code: string }, IntegrationStatus['health']>(
    (i) => `/api/v1/suppliers/integrations/${i.code}/test-connection`,
    'POST',
    {
      onSuccess: (data, vars) => {
        if (data.ok === true) {
          toast.success(`${vars.code}: ok (${data.latencyMs} ms)`);
        } else if (data.ok === false) {
          toast.error(`${vars.code}: ${data.message ?? 'failed'}`);
        } else {
          toast.message(`${vars.code}: ${data.message ?? 'no probe available'}`);
        }
        invalidate();
      },
      onError: (err, vars) => toast.error(`${vars.code}: ${err.message}`),
    },
  );

  const toggling = useApiMutation<
    { code: string; disabled: boolean },
    { code: string; disabled: boolean }
  >((i) => `/api/v1/suppliers/integrations/${i.code}/toggle`, 'POST', {
    onSuccess: (data) => {
      toast.success(
        data.disabled
          ? `${data.code} disabled — propagating to fleet (~30s)`
          : `${data.code} re-enabled`,
      );
      invalidate();
    },
    onError: (err, vars) => toast.error(`${vars.code}: ${err.message}`),
  });

  function onTest(code: string) {
    testing.mutate({ code });
  }

  function onToggle(row: IntegrationStatus) {
    if (!row.toggleable) {
      toast.message(`${row.name} is platform-internal and can't be toggled.`);
      return;
    }
    const willDisable = !row.overrideDisabled;
    toggling.mutate({ code: row.code, disabled: willDisable });
  }

  function onRefreshAll() {
    list.refetch();
  }

  const rows = list.data ?? [];
  const okCount = rows.filter((r) => r.effective === 'ON').length;
  const offCount = rows.length - okCount;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Live</p>
            <p className="mt-0.5 text-lg font-bold text-ink-1">{okCount}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Off</p>
            <p className="mt-0.5 text-lg font-bold text-ink-1">{offCount}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Total integrations</p>
            <p className="mt-0.5 text-lg font-bold text-ink-1">{rows.length}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onRefreshAll} disabled={list.isFetching}>
          <RefreshCw className={cn('h-3.5 w-3.5', list.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </Card>

      {/* Cards grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-44 animate-pulse bg-surface-2" />
            ))
          : rows.map((row) => (
              <IntegrationCard
                key={row.code}
                row={row}
                testing={testing.isPending && testing.variables?.code === row.code}
                toggling={toggling.isPending && toggling.variables?.code === row.code}
                onTest={() => onTest(row.code)}
                onToggle={() => onToggle(row)}
              />
            ))}
      </div>
    </div>
  );
}

function IntegrationCard({
  row,
  testing,
  toggling,
  onTest,
  onToggle,
}: {
  row: IntegrationStatus;
  testing: boolean;
  toggling: boolean;
  onTest: () => void;
  onToggle: () => void;
}) {
  const on = row.effective === 'ON';
  const healthTone =
    row.health.ok === true
      ? 'text-success'
      : row.health.ok === false
        ? 'text-danger'
        : 'text-ink-4';

  return (
    <Card
      className={cn(
        'relative flex h-full flex-col overflow-hidden p-5 transition-shadow hover:shadow-md',
        !on && 'bg-surface-2/40',
      )}
    >
      {/* Vertical state stripe on the left */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          on ? 'bg-gradient-to-b from-success via-success/80 to-success/40' : 'bg-ink-4/40',
        )}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold tracking-tight text-ink-1">{row.name}</h3>
            <Badge variant={on ? 'brand' : 'neutral'} className="font-normal">
              {row.code}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{row.vendor}</p>
        </div>

        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
            on ? 'bg-success/15 text-success' : 'bg-ink-4/15 text-ink-3',
          )}
        >
          <span className="live-dot bg-current" />
          {on ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* Products */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {row.products.map((p) => {
          const Icon = PRODUCT_ICONS[p];
          return (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-md border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-2"
            >
              <Icon className="h-3 w-3" strokeWidth={2} />
              {p}
            </span>
          );
        })}
      </div>

      {/* Health row */}
      <div className="mt-4 flex items-center gap-2 text-xs">
        {row.health.ok === true ? (
          <CheckCircle2 className={cn('h-4 w-4 shrink-0', healthTone)} />
        ) : row.health.ok === false ? (
          <AlertCircle className={cn('h-4 w-4 shrink-0', healthTone)} />
        ) : (
          <HelpCircle className={cn('h-4 w-4 shrink-0', healthTone)} />
        )}
        <span className={cn('truncate', healthTone)}>
          {row.health.ok === null
            ? 'No probe yet'
            : row.health.ok
              ? `OK · ${row.health.latencyMs ?? '?'} ms`
              : row.health.message ?? 'failed'}
        </span>
        {row.health.probedAt ? (
          <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-ink-4">
            {new Date(row.health.probedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {/* Off reason — only when relevant */}
      {row.effective === 'OFF' && row.offReason ? (
        <p className="mt-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
          {row.offReason}
        </p>
      ) : null}

      {/* Override note */}
      {row.override?.note ? (
        <p className="mt-2 truncate text-[11px] italic text-ink-3">“{row.override.note}”</p>
      ) : null}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button
          size="sm"
          variant="secondary"
          onClick={onTest}
          disabled={testing}
          className="flex-1"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wifi className="h-3.5 w-3.5" />
          )}
          {testing ? 'Testing…' : 'Test now'}
        </Button>
        {row.toggleable ? (
          <Button
            size="sm"
            variant={row.overrideDisabled ? 'primary' : 'danger'}
            onClick={onToggle}
            disabled={toggling}
            className="flex-1"
          >
            {toggling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : row.overrideDisabled ? (
              <Power className="h-3.5 w-3.5" />
            ) : (
              <PowerOff className="h-3.5 w-3.5" />
            )}
            {row.overrideDisabled ? 'Enable' : 'Disable'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled
            className="flex-1 cursor-default text-ink-4"
            title="Platform-internal adapter — not toggleable"
          >
            Internal
          </Button>
        )}
      </div>
    </Card>
  );
}
