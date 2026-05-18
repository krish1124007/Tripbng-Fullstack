'use client';

// /visa/countries — bare redirect. Without this file, the literal string
// "countries" would fall through to /visa/[country]/page.tsx and render the
// "Country not found" empty state. Bouncing back to /visa keeps the URL clean.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function VisaCountriesIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/visa');
  }, [router]);
  return (
    <div className="grid h-72 place-items-center text-ink-3">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}
