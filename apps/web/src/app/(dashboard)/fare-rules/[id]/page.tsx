'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { PublicFareRule } from '@tripbng/shared';
import { Button, PageHeader, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { FareRuleForm } from '../_fare-rule-form';

export default function EditFareRulePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const rule = useApiQuery<PublicFareRule>(['fare-rule', id], `/api/v1/fare-rules/${id}`);

  if (rule.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Pricing" title="Edit fare rule" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (rule.isError || !rule.data) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Pricing" title="Fare rule not found" />
        <p className="text-sm text-ink-3">{rule.error?.message ?? 'This fare rule could not be loaded.'}</p>
        <Link href="/fare-rules">
          <Button variant="secondary">Back to fare rules</Button>
        </Link>
      </div>
    );
  }

  return <FareRuleForm mode="edit" ruleId={id} initial={rule.data} />;
}
