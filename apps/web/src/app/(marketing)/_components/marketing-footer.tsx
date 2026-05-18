'use client';

import Link from 'next/link';
import { Github, Linkedin, Twitter } from 'lucide-react';
import { Logo } from '@/components/logo';

const COLS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { href: '#why', label: 'Why TripBng' },
      { href: '#network', label: 'Network' },
      { href: '#roles', label: 'For your team' },
      { href: '#stories', label: 'Stories' },
      { href: '/mobile', label: 'Mobile app' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/careers', label: 'Careers' },
      { href: '/press', label: 'Press kit' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { href: '/docs', label: 'Trade docs' },
      { href: '/api', label: 'API reference' },
      { href: '/status', label: 'Status' },
      { href: '/help', label: 'Help center' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/dpdp', label: 'DPDP' },
      { href: '/refund', label: 'Refund policy' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="max-w-xs space-y-4">
            <Logo variant="full" className="h-7" />
            <p className="text-sm leading-relaxed text-ink-3">
              Built for India&apos;s travel trade. Search, hold, ticket, and reconcile — every paisa
              traceable, every supplier connected.
            </p>
            <div className="flex items-center gap-2">
              <SocialIcon href="#" label="Twitter">
                <Twitter className="h-3.5 w-3.5" />
              </SocialIcon>
              <SocialIcon href="#" label="LinkedIn">
                <Linkedin className="h-3.5 w-3.5" />
              </SocialIcon>
              <SocialIcon href="#" label="GitHub">
                <Github className="h-3.5 w-3.5" />
              </SocialIcon>
            </div>
          </div>

          {COLS.map((col) => (
            <div key={col.heading}>
              <p className="eyebrow mb-4 text-ink-3">{col.heading}</p>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-ink-2 transition-colors hover:text-brand-600"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start gap-3 border-t pt-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Tripbng India Private Limited. All rights reserved. Made
            in India.
          </p>
          <p className="font-mono text-[11px]">v1.0 · DPDP Act 2023 compliant</p>
        </div>
      </div>
    </footer>
  );
}

function SocialIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-md border bg-surface-1 text-ink-3 transition-colors hover:border-brand-300 hover:text-brand-600"
    >
      {children}
    </a>
  );
}
