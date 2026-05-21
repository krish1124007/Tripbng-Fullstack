'use client';

// Segment-level error boundary for the dashboard. Sits below the (dashboard)
// layout, so a render exception inside a dashboard page still shows the
// sidebar + bottom-nav + top bar — the agent isn't dumped to a chrome-less
// "Application error" screen.
//
// The root-level apps/web/src/app/error.tsx is the fallback when this one
// itself fails to mount.

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[dashboard/error]', error.digest, error.message);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-6 inline-flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-7"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 className="mb-2 text-xl font-semibold">Couldn&apos;t render this page</h2>
      <p className="mb-6 text-sm text-ink-3">
        Something went wrong on the dashboard. Use the sidebar to navigate away, or try
        again — most state is restored on a fresh render.
      </p>
      {error.digest ? (
        <p className="mb-6 font-mono text-xs text-ink-3">Ref: {error.digest}</p>
      ) : null}
      <div className="flex gap-3">
        <Button onClick={reset} type="button">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Dashboard home</Link>
        </Button>
      </div>
    </div>
  );
}
