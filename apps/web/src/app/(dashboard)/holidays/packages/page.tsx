'use client';

// /holidays/packages — bare redirect. Without this file, the literal string
// "packages" would fall through to /holidays/[id]/page.tsx and render the
// "Search session expired" empty state. Bouncing back to the landing keeps
// the URL clean.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function HolidaysPackagesIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/holidays');
  }, [router]);
  return (
    <div className="grid h-72 place-items-center text-ink-3">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}
