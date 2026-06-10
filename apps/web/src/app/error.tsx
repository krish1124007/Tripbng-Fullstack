'use client';

// Global error boundary for the app — catches render exceptions that escape
// segment-level boundaries. Next.js wraps the entire root segment with this
// component automatically (any uncaught error from `app/`). Without it, an
// exception in any page renders the framework's default white "Application
// error" screen, no nav, no recovery.
//
// `reset()` re-renders the segment; pair it with a hard-refresh fallback for
// errors that come from corrupt state the React tree can't recover from on
// its own (auth-store mismatch, stale chunks).

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the console so the support team can correlate
    // with server-side logs without exposing the stack trace to the user.
    // eslint-disable-next-line no-console
    console.error('[app/error]', error.digest, error.message);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-surface-0 text-ink-1">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24 text-center">
          <div className="mb-6 inline-flex size-16 items-center justify-center rounded-full bg-danger/10 text-danger">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-8"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="mb-2 text-2xl font-semibold">Something went wrong</h1>
          <p className="mb-6 text-sm text-ink-3">
            We hit an unexpected error while rendering this page. Refresh to try again,
            or contact support if it keeps happening.
          </p>
          {error.digest ? (
            <p className="mb-6 font-mono text-xs text-ink-3">Ref: {error.digest}</p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Try again
            </button>
            <Link
              href="/"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface-1"
            >
              Go home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
