// 404 page for the app — Next.js routes any unmatched URL here.
//
// Server component (no 'use client'): no interactivity needed, the back-link
// is just an anchor.

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-6 inline-flex size-16 items-center justify-center rounded-full bg-surface-2 text-ink-3">
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
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <h1 className="mb-2 text-2xl font-semibold">Page not found</h1>
      <p className="mb-6 text-sm text-ink-3">
        The page you tried to open doesn&apos;t exist on TripBng. Check the link or head
        back to the dashboard.
      </p>
      <Link
        href="/"
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
      >
        Go home
      </Link>
    </div>
  );
}
