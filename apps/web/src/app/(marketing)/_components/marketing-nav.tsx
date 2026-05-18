'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Menu, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/#why', label: 'Why TripBng' },
  { href: '/#network', label: 'Network' },
  { href: '/#roles', label: 'For your team' },
  { href: '/#stories', label: 'Stories' },
  { href: '/#faq', label: 'FAQ' },
];

export function MarketingNav() {
  // Fully-opaque white header. We keep one scroll-driven affordance — a
  // hairline gradient border that intensifies on scroll, plus a soft
  // shadow — so the nav doesn't feel "stuck" on top of content but
  // never gets translucent enough to compete with the hero's colours.
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isSignedIn = hydrated && Boolean(user);
  const ctaHref = isSignedIn ? '/dashboard' : '/login';
  const ctaLabel = isSignedIn ? 'Go to dashboard' : 'Sign in';

  // Active-link detection — anchor hashes (#why) only highlight on the
  // landing page; explicit paths (/about, /contact) highlight when the
  // user is on that page. Keeps top-nav state honest across the site.
  function isActive(href: string): boolean {
    if (href.startsWith('/#')) return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-40 bg-white transition-shadow duration-normal',
          scrolled ? 'shadow-[0_1px_0_0_rgba(15,23,42,0.06),0_8px_24px_-12px_rgba(15,23,42,0.12)]' : '',
        )}
      >
        {/* Gradient hairline at the very bottom of the header — appears on
            scroll, hides at the very top so the hero meets the nav cleanly.
            A real <hr> for a11y; the gradient is decorative. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent transition-opacity duration-normal',
            scrolled ? 'opacity-100' : 'opacity-0',
          )}
        />

        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6 lg:h-[68px] lg:px-8">
          <Link
            href="/"
            aria-label="TripBng — Home"
            className="group relative flex items-center gap-2"
          >
            {/* Soft gradient halo behind the wordmark on hover — feels like
                the brand mark is "lit" without leaning on a static badge. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-x-2 -inset-y-1 rounded-lg bg-gradient-to-r from-brand-500/0 via-brand-500/10 to-accent-500/0 opacity-0 blur-md transition-opacity duration-normal group-hover:opacity-100"
            />
            <Logo variant="full" className="relative h-7 w-auto" />
          </Link>

          <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = isActive(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    'relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    active ? 'text-ink-1' : 'text-ink-2 hover:text-ink-1',
                  )}
                >
                  {l.label}
                  {/* Animated gradient underline — slides in on hover and
                      stays for the active route. Pure decoration; the link's
                      colour change does the real signalling. */}
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-x-3 bottom-0 h-[2px] origin-left rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-transform duration-normal',
                      active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          {/* CTA — gradient primary button with shadow glow. The "Apply" link
              sits left of it as a lightweight ghost so new partners have
              a path without crowding sign-in. */}
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {!isSignedIn ? (
              <Link
                href="/register"
                className="text-sm font-medium text-ink-2 transition-colors hover:text-ink-1"
              >
                Apply to partner
              </Link>
            ) : null}
            <Button asChild className="group relative overflow-hidden">
              <Link href={ctaHref}>
                {/* Layered gradient — base button is brand; this overlay
                    introduces a slow accent shimmer on hover. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                />
                <span className="relative inline-flex items-center gap-1.5">
                  {!isSignedIn ? <Sparkles className="h-4 w-4" /> : null}
                  {ctaLabel} <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="ml-auto grid h-9 w-9 place-items-center rounded-md text-ink-1 transition-colors hover:bg-surface-2 md:hidden"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Mobile sheet */}
      {open ? (
        <div
          className="fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 top-0 animate-slide-down rounded-b-2xl border-b bg-surface-1 p-5"
          >
            <div className="flex items-center justify-between">
              <Logo variant="full" className="h-7" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="mt-4 flex flex-col">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-3 text-base font-medium text-ink-1 transition-colors hover:bg-surface-2"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-4">
              <Button asChild size="lg" className="w-full">
                <Link href={ctaHref}>
                  {ctaLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
