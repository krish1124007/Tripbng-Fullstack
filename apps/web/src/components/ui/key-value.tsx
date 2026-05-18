import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function KeyValue({
  label,
  value,
  className,
  mono = false,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-xs uppercase tracking-wider text-ink-3">{label}</span>
      <span className={cn('text-sm text-ink-1', mono && 'font-mono')}>{value}</span>
    </div>
  );
}
