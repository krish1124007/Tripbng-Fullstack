'use client';

import { ProductEditor } from '@/components/visa-admin/ProductEditor';
import { emptyProduct } from '@/components/visa-admin/types';

export default function NewVisaProductPage() {
  return <ProductEditor mode="new" initial={emptyProduct()} />;
}
