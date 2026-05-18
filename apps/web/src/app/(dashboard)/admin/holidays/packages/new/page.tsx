'use client';

import { PackageEditor } from '@/components/holidays-admin/PackageEditor';
import { emptyPackage } from '@/components/holidays-admin/types';

export default function NewHolidayPackagePage() {
  return <PackageEditor mode="new" initial={emptyPackage()} />;
}
