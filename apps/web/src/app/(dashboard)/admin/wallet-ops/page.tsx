'use client';

// Admin → Wallet ops landing card. Two surfaces live underneath:
//   • Adjustments — manual credits/debits with two-person approval
//   • Distributor transfers — approval queue for above-threshold transfers

import Link from 'next/link';
import { ArrowLeftRight, ArrowRight, Shield, Wallet2 } from 'lucide-react';
import {
  Card,
  CardContent,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';

const SURFACES = [
  {
    href: '/admin/wallet-ops/adjustments',
    icon: Wallet2,
    title: 'Wallet adjustments',
    description:
      'Manual credits and debits against agency or distributor wallets. Two-person approval above the threshold.',
  },
  {
    href: '/admin/wallet-ops/transfers',
    icon: ArrowLeftRight,
    title: 'Distributor transfers',
    description:
      'Approve, reject, or recall distributor → agency wallet transfers that crossed the approval threshold.',
  },
] as const;

export default function WalletOpsIndexPage() {
  const me = useAuthStore((s) => s.user);
  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="Wallet operations are restricted to platform super-admins."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Wallet operations"
        description="Two-person approval surfaces for the manual and threshold-gated wallet flows. Every action here writes to the ledger and notifies the affected party."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {SURFACES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-start gap-4 rounded-lg border bg-surface-1 p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300">
              <s.icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="flex items-center gap-1.5 text-base font-semibold text-ink-1">
                {s.title}
                <ArrowRight className="h-4 w-4 text-ink-3 transition-transform group-hover:translate-x-0.5" />
              </p>
              <p className="mt-1 text-sm text-ink-3">{s.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
