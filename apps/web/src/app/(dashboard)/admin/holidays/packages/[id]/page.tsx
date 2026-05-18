'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { AdminHolidayPackage } from '@tripbng/shared';
import { Button, EmptyState } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { PackageEditor } from '@/components/holidays-admin/PackageEditor';

export default function EditHolidayPackagePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const detail = useApiQuery<AdminHolidayPackage>(
    ['admin-holiday-package', id],
    `/api/v1/admin/holidays/packages/${id}`,
  );

  if (detail.isLoading) {
    return (
      <div className="grid h-72 place-items-center text-ink-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading package…
        </div>
      </div>
    );
  }

  if (detail.error) {
    const code = detail.error instanceof ApiCallError ? detail.error.message : 'Failed to load';
    return (
      <EmptyState
        title="Package not found"
        description={code}
        action={
          <Button variant="secondary" onClick={() => router.push('/admin/holidays/packages')}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </Button>
        }
      />
    );
  }

  if (!detail.data) return null;

  return <PackageEditor mode="edit" initial={detail.data} />;
}
