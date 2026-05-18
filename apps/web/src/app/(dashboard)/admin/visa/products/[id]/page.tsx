'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { AdminVisaProduct } from '@tripbng/shared';
import { Button, EmptyState } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { ProductEditor } from '@/components/visa-admin/ProductEditor';

export default function EditVisaProductPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const detail = useApiQuery<AdminVisaProduct>(
    ['admin-visa-product', id],
    `/api/v1/admin/visa/products/${id}`,
  );

  if (detail.isLoading) {
    return (
      <div className="grid h-72 place-items-center text-ink-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading product…
        </div>
      </div>
    );
  }

  if (detail.error) {
    const code = detail.error instanceof ApiCallError ? detail.error.message : 'Failed to load';
    return (
      <EmptyState
        title="Visa product not found"
        description={code}
        action={
          <Button variant="secondary" onClick={() => router.push('/admin/visa/products')}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </Button>
        }
      />
    );
  }

  if (!detail.data) return null;

  return <ProductEditor mode="edit" initial={detail.data} />;
}
