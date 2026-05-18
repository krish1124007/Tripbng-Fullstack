'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  Compass,
  Heart,
  Lightbulb,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { CountUp } from '../_components/count-up';
import { Reveal } from '../_components/reveal';

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About TripBng"
        title={
          <>
            Built by travel agents,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              for travel agents.
            </span>
          </>
        }
        subtitle={
          <>
            Tripbng India Private Limited operates the country&apos;s most opinionated B2B travel
            platform — built around a simple idea: every paisa should be traceable, every supplier
            connected, and every workflow under one roof. We&apos;re a small team headquartered in
            Mumbai, shipping software for the people who actually sell tickets.
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/contact">
                Talk to us <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/careers">Open roles</Link>
            </Button>
          </>
        }
      />

      <Numbers />
      <Story />
      <Values />
      <Leadership />
      <CtaBand />
    </>
  );
}

// ───────────────────── Numbers ─────────────────────

const NUMBERS = [
  { value: <CountUp to={12400} suffix="+" />, label: 'Travel agencies' },
  { value: <CountUp to={420} />, label: 'Cities served' },
  { value: <CountUp to={84} prefix="₹" suffix=" Cr" />, label: 'Monthly GMV' },
  { value: <CountUp to={35} />, label: 'Airlines + suppliers' },
];

function Numbers() {
  return (
    <section className="bg-surface-1 py-14 lg:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NUMBERS.map((n, i) => (
            <Reveal key={n.label} delay={i * 60}>
              <Card className="p-6">
                <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">{n.value}</p>
                <p className="mt-1 text-sm font-medium text-ink-3">{n.label}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── Story ─────────────────────

function Story() {
  return (
    <section className="bg-surface-0 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="eyebrow text-brand-600">Our story</p>
            <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
              We were the agency complaining about agency software.
            </h2>
          </Reveal>
          <Reveal delay={120} className="space-y-5 text-base leading-relaxed text-ink-2 lg:text-[17px]">
            <p>
              In 2022, our founders were running a 14-person retail travel agency in Indore. Every
              evening ended the same way — a four-hour Excel-and-WhatsApp reconciliation between
              series fares, LCC PNRs, and three different supplier portals.
            </p>
            <p>
              We tried four platforms. Each one fixed a third of the problem and added two new
              ones. So we built our own — a single search bar across series, LCC, and FSC, with
              a wallet that adds up to the rupee, a distributor cockpit that surfaces the
              dormant agency before you notice, and invoices accountants don&apos;t flag.
            </p>
            <p>
              Two years on, TripBng powers reservations for travel agencies across 420+ cities.
              We&apos;re still small, still based in India, and still answer the phone when
              partners call.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ───────────────────── Values ─────────────────────

const VALUES = [
  {
    icon: Compass,
    title: 'Agent-led design',
    body:
      'Every feature is shaped with three partner agencies before it ships. If it doesn’t earn its place on a busy Friday counter, it doesn’t ship.',
  },
  {
    icon: ShieldCheck,
    title: 'Atomic by default',
    body:
      'Wallets, holds, and ticketing share one transaction boundary. No partial states, no “wait for the cron to fix it” drift.',
  },
  {
    icon: Heart,
    title: 'Trade desk over chatbot',
    body:
      'Real people answer in four languages. Median first response under 90 seconds. We measure it weekly.',
  },
  {
    icon: Lightbulb,
    title: 'India-shaped engineering',
    body:
      'UPI, GST, DPDP, IRCTC quirks, IATA edges, and operator-specific BP/DP rules — baked in from day one, not bolted on.',
  },
];

function Values() {
  return (
    <section className="bg-surface-1 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Principles</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Four things we won&apos;t trade off.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {VALUES.map((v, i) => (
            <Reveal key={v.title} delay={i * 70}>
              <Card interactive className="h-full p-7">
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <v.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{v.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── Leadership ─────────────────────

const TEAM = [
  {
    initials: 'PS',
    name: 'Parth Savajadiya',
    role: 'Founder & CEO',
    bio: 'Built TripBng after running a retail travel agency. Engineer by training, agent by trade.',
  },
  {
    initials: 'AT',
    name: 'Ananya Tripathi',
    role: 'Head of Trade',
    bio: '12 years across BCD, FCM, and consolidators. Runs partner onboarding + the trade desk.',
  },
  {
    initials: 'RM',
    name: 'Rohan Mehta',
    role: 'Head of Engineering',
    bio: 'Ex-Razorpay, ex-Cleartrip. Owns the ledger, search, and infra.',
  },
  {
    initials: 'NS',
    name: 'Neha Sharma',
    role: 'Head of Design',
    bio: 'Previously at Zerodha. Brings the patience of a counter agent into every screen.',
  },
];

function Leadership() {
  return (
    <section className="bg-surface-0 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Leadership</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Small team. Long memory of how travel actually works.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM.map((p, i) => (
            <Reveal key={p.name} delay={i * 70}>
              <Card className="h-full p-6">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-base font-bold text-white shadow-sm">
                  {p.initials}
                </span>
                <h3 className="mt-4 text-base font-bold tracking-tight text-ink-1">{p.name}</h3>
                <p className="font-mono text-[11px] uppercase tracking-wider text-brand-600">
                  {p.role}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-ink-3">{p.bio}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── CTA band ─────────────────────

function CtaBand() {
  return (
    <section className="bg-surface-1 py-16">
      <div className="mx-auto grid max-w-7xl gap-6 px-6 sm:grid-cols-3 lg:px-8">
        <Reveal>
          <Card className="h-full p-6">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Building2 className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="mt-3 text-base font-bold text-ink-1">Partner with us</h3>
            <p className="mt-1 text-sm text-ink-3">
              Bring your agency network onto a single ledger.
            </p>
            <Button asChild variant="link" className="mt-3 -ml-3">
              <Link href="/contact">
                Apply to partner <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>
        </Reveal>
        <Reveal delay={80}>
          <Card className="h-full p-6">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Users className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="mt-3 text-base font-bold text-ink-1">Join the team</h3>
            <p className="mt-1 text-sm text-ink-3">Mumbai · remote-friendly · 14 open roles.</p>
            <Button asChild variant="link" className="mt-3 -ml-3">
              <Link href="/careers">
                Open roles <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>
        </Reveal>
        <Reveal delay={160}>
          <Card className="h-full p-6">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Target className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="mt-3 text-base font-bold text-ink-1">Press &amp; brand</h3>
            <p className="mt-1 text-sm text-ink-3">Logos, screenshots, founder bios.</p>
            <Button asChild variant="link" className="mt-3 -ml-3">
              <Link href="/press">
                Open press kit <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}
