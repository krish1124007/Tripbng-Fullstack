'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Award,
  Calendar,
  Download,
  FileText,
  Image as ImageIcon,
  Mail,
  Newspaper,
  Palette,
  Quote,
  Users,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

const FACTS = [
  { label: 'Founded', value: '2022' },
  { label: 'HQ', value: 'Mumbai, India' },
  { label: 'Team', value: '64 people' },
  { label: 'Agencies served', value: '12,400+' },
  { label: 'Monthly GMV', value: '₹84 Cr' },
  { label: 'Cities live', value: '420' },
];

const ASSETS = [
  {
    icon: Palette,
    title: 'Logo pack',
    desc: 'Wordmark + symbol in SVG, PNG, and EPS. Light and dark variants.',
    size: '1.2 MB · ZIP',
    href: '/press/tripbng-logos.zip',
  },
  {
    icon: ImageIcon,
    title: 'Product screenshots',
    desc: 'Dashboard, search, wallet, distributor cockpit. 4K @ 2x.',
    size: '14.8 MB · ZIP',
    href: '/press/tripbng-screens.zip',
  },
  {
    icon: Users,
    title: 'Founder portraits',
    desc: 'Square + landscape headshots. Captions and bios included.',
    size: '6.4 MB · ZIP',
    href: '/press/tripbng-team.zip',
  },
  {
    icon: FileText,
    title: 'One-page brief',
    desc: 'Company story, numbers, milestones — for editors on deadline.',
    size: '320 KB · PDF',
    href: '/press/tripbng-brief.pdf',
  },
];

const NEWS = [
  {
    date: '2026-03-12',
    title: 'TripBng crosses ₹1,000 Cr in lifetime GMV',
    source: 'Mint',
    href: '#',
  },
  {
    date: '2026-01-08',
    title: 'India\'s travel agents finally have software they didn\'t hate',
    source: 'The Ken',
    href: '#',
  },
  {
    date: '2025-11-22',
    title: 'How TripBng built a distributor cockpit travel chains envy',
    source: 'Inc42',
    href: '#',
  },
  {
    date: '2025-09-04',
    title: 'TripBng raises Series A to scale series-fare aggregation',
    source: 'YourStory',
    href: '#',
  },
];

const QUOTES = [
  {
    quote:
      'The platform agents asked for, not the one platforms tried to sell. We built the ledger first, the search second, and the dashboard third — in that order, intentionally.',
    name: 'Parth Savajadiya',
    role: 'Founder & CEO',
  },
  {
    quote:
      'Our reconciliation went from four hours every Friday to under 15 minutes. The ledger just adds up.',
    name: 'Priya Sharma',
    role: 'Owner, Sharma Travels (Lucknow)',
  },
];

export default function PressPage() {
  return (
    <>
      <PageHero
        eyebrow="Press kit"
        title={
          <>
            Everything you need to{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              file before deadline.
            </span>
          </>
        }
        subtitle={
          <>
            Logos, screenshots, founder bios, fact sheets, and recent coverage — all in one place.
            For interviews, email{' '}
            <a href="mailto:press@tripbng.com" className="font-semibold text-brand-700 hover:underline">
              press@tripbng.com
            </a>
            . Median response under 4 hours.
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <a href="/press/tripbng-press-kit.zip" download>
                <Download className="h-4 w-4" /> Download full kit
              </a>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="mailto:press@tripbng.com">
                <Mail className="h-4 w-4" /> press@tripbng.com
              </a>
            </Button>
          </>
        }
      />

      {/* Quick facts ribbon */}
      <section className="bg-surface-1 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FACTS.map((f, i) => (
              <Reveal key={f.label} delay={i * 50}>
                <Card className="p-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                    {f.label}
                  </p>
                  <p className="mt-1 text-lg font-bold tracking-tight text-ink-1">{f.value}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <Assets />
      <Quotes />
      <Coverage />
    </>
  );
}

function Assets() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Brand assets</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            High-res, properly cropped, properly named.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {ASSETS.map((a, i) => (
            <Reveal key={a.title} delay={i * 70}>
              <Card interactive className="flex h-full items-start gap-4 p-6">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <a.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold tracking-tight text-ink-1">{a.title}</h3>
                  <p className="mt-1 text-sm text-ink-3">{a.desc}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="font-mono text-xs text-ink-4">{a.size}</p>
                    <a
                      href={a.href}
                      download
                      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      Download <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Quotes() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Quotes</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Yours to use — attribution as printed.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {QUOTES.map((q, i) => (
            <Reveal key={q.name} delay={i * 70}>
              <Card className="relative h-full overflow-hidden p-7">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-2 -top-4 select-none font-serif text-[120px] leading-none text-brand-100"
                >
                  &ldquo;
                </span>
                <div className="relative">
                  <Quote className="h-5 w-5 text-brand-600" strokeWidth={1.75} />
                  <p className="mt-3 text-base leading-relaxed text-ink-1 lg:text-[15px]">
                    &ldquo;{q.quote}&rdquo;
                  </p>
                  <div className="mt-5 border-t pt-4">
                    <p className="text-sm font-semibold text-ink-1">{q.name}</p>
                    <p className="font-mono text-[11px] text-ink-3">{q.role}</p>
                  </div>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Coverage() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Recent coverage</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            What editors have said this year.
          </h2>
        </Reveal>
        <div className="mt-10 overflow-hidden rounded-xl border bg-surface-1">
          {NEWS.map((n, i) => (
            <Link
              key={n.title}
              href={n.href}
              className={`group flex items-center gap-5 px-6 py-4 transition-colors hover:bg-surface-2 ${
                i !== NEWS.length - 1 ? 'border-b' : ''
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
                <Newspaper className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink-1 group-hover:text-brand-700">
                  {n.title}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                  <Calendar className="h-3 w-3" />
                  <time>{new Date(n.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
                  <span>·</span>
                  <Badge variant="brand" className="font-normal">
                    {n.source}
                  </Badge>
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700" />
            </Link>
          ))}
        </div>
        <Reveal className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <Award className="h-5 w-5 text-accent-600" />
            <h3 className="mt-2 text-base font-bold text-ink-1">Brand guidelines</h3>
            <p className="mt-1 text-sm text-ink-3">
              Colors, type, voice. Please follow when reproducing the wordmark.
            </p>
            <Button asChild variant="link" className="mt-2 -ml-3">
              <a href="/press/tripbng-brand-guide.pdf" download>
                Open guide <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </Card>
          <Card className="p-5">
            <Mail className="h-5 w-5 text-brand-600" />
            <h3 className="mt-2 text-base font-bold text-ink-1">Pitching us a story?</h3>
            <p className="mt-1 text-sm text-ink-3">
              Email press@tripbng.com with your outlet, angle, and deadline. We respond same day.
            </p>
            <Button asChild variant="link" className="mt-2 -ml-3">
              <a href="mailto:press@tripbng.com">
                press@tripbng.com <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}
