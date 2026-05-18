'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  CreditCard,
  HelpCircle,
  Mail,
  MessageSquare,
  PhoneCall,
  PlaneTakeoff,
  Receipt,
  Search,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

const CATEGORIES = [
  {
    icon: PlaneTakeoff,
    title: 'Search & booking',
    desc: 'Series, LCC, FSC, holds, ticketing, reissues, cancellations.',
    href: '#search',
    count: 22,
  },
  {
    icon: Wallet,
    title: 'Wallet & top-ups',
    desc: 'UPI / NEFT / RTGS top-ups, credit limits, statements.',
    href: '#wallet',
    count: 14,
  },
  {
    icon: Users,
    title: 'Sub-agents & RBAC',
    desc: 'Roles, permissions, credit caps, audit trails.',
    href: '#agents',
    count: 11,
  },
  {
    icon: Receipt,
    title: 'Invoices & GST',
    desc: 'Tax invoices, credit notes, debit notes, GSTR-1 export.',
    href: '#invoices',
    count: 18,
  },
  {
    icon: Building2,
    title: 'Distributor cockpit',
    desc: 'Earnings, overrides, dormant-agency alerts, drill-downs.',
    href: '#distributor',
    count: 9,
  },
  {
    icon: ShieldCheck,
    title: 'Security & 2FA',
    desc: 'Login, two-factor, recovery codes, audit logs.',
    href: '#security',
    count: 7,
  },
  {
    icon: CreditCard,
    title: 'Refunds',
    desc: 'How refunds reach the wallet, timelines, partial refunds.',
    href: '#refunds',
    count: 12,
  },
  {
    icon: BookOpen,
    title: 'KYC & onboarding',
    desc: 'PAN, GSTIN, IATA / TAFI, document validation.',
    href: '#kyc',
    count: 13,
  },
];

const POPULAR = [
  { q: 'How long does KYC take?', a: 'Self-serve completes in about 24 hours once documents are uploaded. You can run searches the same day; ticketing opens once KYC clears.', href: '#kyc' },
  { q: 'My wallet top-up didn’t reflect — what now?', a: 'Razorpay UPI takes up to 90 seconds. NEFT/RTGS can take 30 minutes during banking hours. If it’s still missing, check Wallet → Top-ups for status, or call the trade desk with the bank reference.', href: '#wallet' },
  { q: 'Can I cancel a ticket after issuance?', a: 'Yes — go to Bookings, open the PNR, click Cancel. Refundability depends on the fare class; non-refundable fares only return the TripBng convenience fee.', href: '#search' },
  { q: 'How do I add a sub-agent?', a: 'Settings → Team → Invite. Pick a role (Counter / Manager), set a per-day credit cap, and email the invite. They land on a 2FA setup page.', href: '#agents' },
  { q: 'Where are my GSTR-1 invoices?', a: 'Reports → Invoices → Export. Pick the month, click GSTR-1 JSON or CSV. Files mirror what your accountant uploads to the GST portal.', href: '#invoices' },
  { q: 'Why do I see "fare changed" on hold?', a: 'Airlines re-price fares every few seconds. We re-quote at hold so you book the live rate, not a cached one. Accept the new rate to continue, or release the hold.', href: '#search' },
];

export default function HelpPage() {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return POPULAR;
    return POPULAR.filter(
      (p) => p.q.toLowerCase().includes(k) || p.a.toLowerCase().includes(k),
    );
  }, [q]);

  return (
    <>
      <PageHero
        eyebrow="Help center"
        title={
          <>
            Answers, in plain words,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              for busy agents.
            </span>
          </>
        }
        subtitle={
          <>
            106 articles across 8 topics. Median read time under 90 seconds. Can&apos;t find what
            you need? The trade desk is one tap away — 24×7, 90-second first response.
          </>
        }
        actions={
          <div className="relative w-full max-w-xl">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
              strokeWidth={1.75}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search “refund timeline”, “add sub-agent”, “GSTR-1”…"
              className="w-full rounded-lg border bg-surface-1 pl-10 pr-4 py-3 text-sm text-ink-1 placeholder:text-ink-4 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
            />
          </div>
        }
      />

      <Popular results={filtered} hasQuery={q.trim().length > 0} />
      <Categories />
      <Channels />
    </>
  );
}

function Popular({ results, hasQuery }: { results: typeof POPULAR; hasQuery: boolean }) {
  return (
    <section className="bg-surface-1 py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">
            {hasQuery ? `Results · ${results.length}` : 'Most read this week'}
          </p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            {hasQuery ? 'Matches in the help library' : 'Six things partners look up the most.'}
          </h2>
        </Reveal>
        {results.length === 0 ? (
          <Card className="mt-10 grid place-items-center p-12 text-center">
            <HelpCircle className="h-8 w-8 text-ink-3" />
            <h3 className="mt-3 text-lg font-bold text-ink-1">Nothing matched</h3>
            <p className="mt-1 max-w-md text-sm text-ink-3">
              Try simpler keywords or chat with the trade desk — they triage in 90 seconds.
            </p>
            <Button asChild className="mt-4">
              <a href="mailto:trade@tripbng.com">
                <Mail className="h-4 w-4" /> Email the trade desk
              </a>
            </Button>
          </Card>
        ) : (
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {results.map((p, i) => (
              <Reveal key={p.q} delay={i * 40}>
                <Link
                  href={p.href}
                  className="group block h-full rounded-xl border bg-surface-1 p-6 transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md"
                >
                  <h3 className="text-base font-bold tracking-tight text-ink-1 group-hover:text-brand-700">
                    {p.q}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">{p.a}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                    Read more
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Categories() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Browse by topic</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Eight topics. Every workflow on the platform.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c, i) => (
            <Reveal key={c.title} delay={i * 50}>
              <Link
                href={c.href}
                className="group flex h-full flex-col rounded-xl border bg-surface-1 p-5 transition-[border-color,box-shadow] hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <c.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <Badge variant="brand" className="font-normal">
                    {c.count}
                  </Badge>
                </div>
                <h3 className="mt-4 text-base font-bold tracking-tight text-ink-1">{c.title}</h3>
                <p className="mt-1 text-sm text-ink-3">{c.desc}</p>
                <span className="mt-auto pt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                  Open
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Channels() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Still stuck?</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Real people, four languages, 24×7.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: PhoneCall,
              title: 'Phone',
              detail: '+91 22 6196 4040',
              desc: 'Median pickup under 90 seconds.',
              href: 'tel:+912261964040',
              badge: 'Fastest',
            },
            {
              icon: MessageSquare,
              title: 'In-app chat',
              detail: 'Open the dashboard',
              desc: 'Hindi, English, Marathi, Tamil. Always on.',
              href: '/login',
              badge: 'Easiest',
            },
            {
              icon: Mail,
              title: 'Email',
              detail: 'trade@tripbng.com',
              desc: 'Reply within 4 business hours.',
              href: 'mailto:trade@tripbng.com',
              badge: 'For paper trails',
            },
          ].map((c, i) => (
            <Reveal key={c.title} delay={i * 70}>
              <Card className="flex h-full flex-col p-6">
                <Badge variant="brand" className="self-start">
                  {c.badge}
                </Badge>
                <span className="mt-4 grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <c.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{c.title}</h3>
                <p className="mt-1 text-sm text-ink-3">{c.desc}</p>
                <a
                  href={c.href}
                  className="mt-4 break-words text-sm font-semibold text-brand-700 hover:underline"
                >
                  {c.detail}
                </a>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
