'use client';

import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Heart,
  Hospital,
  type LucideIcon,
  Luggage,
  Shield,
  Sparkles,
  Stethoscope,
  X,
} from 'lucide-react';
import type { InsurancePlan } from '@tripbng/shared';
import { Badge, Button, Card } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';
import { fmtUSD } from './utils';

interface ComparisonTableProps {
  plans: InsurancePlan[];
  selectedPlanId: string | null;
  days: number;
  onBuy: (p: InsurancePlan) => void;
}

/**
 * Side-by-side comparison table. Sticky-left first column for the cover label;
 * each plan column highlights when selected. Designed for desktop; horizontally
 * scrollable on tablet/mobile.
 */
export function ComparisonTable({ plans, selectedPlanId, days, onBuy }: ComparisonTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <p className="eyebrow text-brand-600">Side-by-side</p>
          <h3 className="mt-1 text-h3 text-ink-1">Compare cover line by line</h3>
        </div>
        <Badge variant="brand" dot>
          <Sparkles className="h-3 w-3" /> {days}-day trip
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-surface-2">
            <tr>
              <th className="sticky left-0 bg-surface-2 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                Cover
              </th>
              {plans.map((p) => (
                <th
                  key={p.id}
                  className={cn(
                    'min-w-[140px] px-5 py-3 text-center',
                    p.id === selectedPlanId && 'bg-brand-50 dark:bg-brand-500/15',
                  )}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                    {p.carrier}
                  </p>
                  <p className="mt-0.5 text-base font-bold text-ink-1">{p.planName}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CoverRow
              label="Premium per traveller"
              icon={Sparkles}
              plans={plans}
              render={(p) => (
                <span className="font-mono text-base font-bold tabular-nums text-ink-1">
                  {formatRupees(p.premiumRupees)}
                </span>
              )}
              selectedId={selectedPlanId}
              highlight
            />
            <CoverRow
              label="Medical cover"
              icon={Stethoscope}
              plans={plans}
              render={(p) => fmtUSD(p.cover.medicalUSD)}
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Hospitalisation"
              icon={Hospital}
              plans={plans}
              render={(p) => fmtUSD(p.cover.hospitalisationUSD)}
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Baggage cover"
              icon={Luggage}
              plans={plans}
              render={(p) => fmtUSD(p.cover.baggageUSD)}
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Trip cancellation"
              icon={CalendarIcon}
              plans={plans}
              render={(p) => fmtUSD(p.cover.cancellationUSD)}
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Dental emergencies"
              icon={Heart}
              plans={plans}
              render={(p) => fmtUSD(p.cover.dentalUSD)}
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Adventure sports"
              icon={Shield}
              plans={plans}
              render={(p) =>
                p.cover.adventureSports ? (
                  <CheckCircle2 className="mx-auto h-4 w-4 text-success" strokeWidth={2.5} />
                ) : (
                  <X className="mx-auto h-4 w-4 text-ink-4" strokeWidth={2} />
                )
              }
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Pre-existing diseases"
              icon={Heart}
              plans={plans}
              render={(p) =>
                p.cover.preExisting ? (
                  <CheckCircle2 className="mx-auto h-4 w-4 text-success" strokeWidth={2.5} />
                ) : (
                  <X className="mx-auto h-4 w-4 text-ink-4" strokeWidth={2} />
                )
              }
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Cashless network"
              icon={Hospital}
              plans={plans}
              render={(p) => `${(p.cover.cashlessNetwork / 1000).toFixed(0)}K hospitals`}
              selectedId={selectedPlanId}
            />
            <CoverRow
              label="Deductible"
              icon={Sparkles}
              plans={plans}
              render={(p) => (p.cover.deductibleUSD === 0 ? 'None' : fmtUSD(p.cover.deductibleUSD))}
              selectedId={selectedPlanId}
            />
            <tr>
              <td className="sticky left-0 bg-surface-1 px-5 py-4 text-left text-xs font-semibold text-ink-3">
                &nbsp;
              </td>
              {plans.map((p) => (
                <td
                  key={p.id}
                  className={cn(
                    'px-3 py-4 text-center',
                    p.id === selectedPlanId && 'bg-brand-50 dark:bg-brand-500/15',
                  )}
                >
                  <Button
                    onClick={() => onBuy(p)}
                    variant={p.id === selectedPlanId ? 'primary' : 'soft'}
                    size="sm"
                    className="w-full"
                  >
                    Pick {p.planName}
                  </Button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CoverRow({
  label,
  icon: Icon,
  plans,
  render,
  selectedId,
  highlight,
}: {
  label: string;
  icon: LucideIcon;
  plans: InsurancePlan[];
  render: (p: InsurancePlan) => React.ReactNode;
  selectedId: string | null;
  highlight?: boolean;
}) {
  return (
    <tr className={cn('border-b last:border-b-0', highlight && 'bg-surface-2/40')}>
      <td className="sticky left-0 bg-surface-1 px-5 py-3 text-left">
        <span className="flex items-center gap-2 text-sm text-ink-2">
          <Icon className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
          {label}
        </span>
      </td>
      {plans.map((p) => (
        <td
          key={p.id}
          className={cn(
            'px-5 py-3 text-center text-sm font-mono tabular-nums text-ink-1',
            p.id === selectedId && 'bg-brand-50 dark:bg-brand-500/15',
          )}
        >
          {render(p)}
        </td>
      ))}
    </tr>
  );
}
