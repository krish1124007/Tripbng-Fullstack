'use client';

import { ArrowRight, CheckCircle2, Heart, Shield } from 'lucide-react';
import type { InsurancePlan } from '@tripbng/shared';
import { Badge, Button, Card } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';

interface PlanTileProps {
  plan: InsurancePlan;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onBuy: () => void;
}

/**
 * Single-plan tile. Shows the carrier, plan name, premium, and 3-5 highlights.
 * Clicking the body selects the plan (highlights it in the comparison table);
 * "View details" routes to the dedicated detail page; "Pick" buys.
 */
export function PlanTile({ plan, selected, onSelect, onView, onBuy }: PlanTileProps) {
  return (
    <Card
      tone={plan.recommended ? 'brand' : 'default'}
      elevation={plan.recommended ? 'raised' : 'flat'}
      interactive
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer p-5 transition-all duration-fast',
        selected && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-0',
        plan.recommended && 'lg:scale-[1.02]',
      )}
    >
      {plan.recommended ? (
        <Badge variant="accent" className="absolute -top-3 right-5">
          <Heart className="h-3 w-3" /> Most chosen
        </Badge>
      ) : null}
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
        <Shield className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
        {plan.carrier}
      </p>
      <h3 className="text-lg font-bold tracking-tight text-ink-1">{plan.planName}</h3>
      <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-ink-1">
        {formatRupees(plan.premiumRupees)}
        <span className="ml-1 text-xs font-normal text-ink-3">/pax</span>
      </p>
      <ul className="mt-3 space-y-1.5">
        {plan.highlights.map((h) => (
          <li key={h} className="flex items-start gap-1.5 text-[11px] text-ink-2">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" strokeWidth={2} />
            <span>{h}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          View details
        </Button>
        <Button
          variant={plan.recommended ? 'primary' : 'soft'}
          onClick={(e) => {
            e.stopPropagation();
            onBuy();
          }}
        >
          Pick {plan.planName} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
