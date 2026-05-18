'use client';

// Legacy mock-data per-plan detail page. The new ASEGO flow keeps the user in
// the wizard at /insurance/buy where they pick + buy in one place; this
// route redirects there.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InsurancePlanDetailLegacyRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/insurance/buy');
  }, [router]);
  return null;
}
