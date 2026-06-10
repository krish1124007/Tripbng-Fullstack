'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { PublicPolicy } from '@tripbng/shared';
import { Button, PageHeader, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { PolicyForm } from '../_policy-form';

export default function EditPolicyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const policy = useApiQuery<PublicPolicy>(['policy', id], `/api/v1/policies/${id}`);

  if (policy.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Manage Policy" title="Edit policy" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Manage Policy" title="Policy not found" />
        <p className="text-sm text-ink-3">{policy.error?.message ?? 'This policy could not be loaded.'}</p>
        <Link href="/policies">
          <Button variant="secondary">Back to policies</Button>
        </Link>
      </div>
    );
  }

  return <PolicyForm mode="edit" policyId={id} initial={policy.data} />;
}
