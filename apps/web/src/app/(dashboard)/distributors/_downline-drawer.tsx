'use client';

import type { PublicAgency, PublicDistributor } from '@tripbng/shared';
import {
  Dialog,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DrawerContent,
  EmptyState,
  KeyValue,
  Separator,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { Network } from 'lucide-react';

export function DownlineDrawer({
  target,
  onOpenChange,
}: {
  target: PublicDistributor | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!target;
  const list = useApiQuery<PublicAgency[]>(
    ['distributor', target?.id, 'downline'],
    `/api/v1/distributors/${target?.id ?? ''}/downline`,
    { enabled: !!target },
  );

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[560px]">
        <DialogHeader>
          <DialogTitle>{target.companyName} · downline</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-6">
          <section className="grid grid-cols-2 gap-4">
            <KeyValue label="Distributor code" value={target.distributorCode} mono />
            <KeyValue label="Override %" value={`${target.overrideCommissionPercent}%`} />
          </section>
          <Separator />

          {list.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : list.data && list.data.length > 0 ? (
            <ul className="space-y-2">
              {list.data.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-md border bg-surface-1 p-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-ink-1">{a.companyName}</span>
                    <span className="font-mono text-xs text-ink-3">{a.agencyCode}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <span>{a.city}</span>
                    <StatusBadge status={a.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Network}
              title="No agencies yet"
              description="Once agencies are recruited under this distributor, they'll appear here."
            />
          )}
        </DialogBody>
      </DrawerContent>
    </Dialog>
  );
}
