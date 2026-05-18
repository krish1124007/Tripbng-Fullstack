'use client';

// Legacy mock-data quote page. Redirects to the live ASEGO buy wizard.
// Bookmarks pointing here keep working — they just land on the new flow.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InsuranceQuoteLegacyRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/insurance/buy');
  }, [router]);
  return null;
}
