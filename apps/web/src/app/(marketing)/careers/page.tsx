'use client';

import {
  ArrowRight,
  Briefcase,
  Coffee,
  HeartHandshake,
  Home,
  Laptop,
  Mail,
  MapPin,
  Plane,
  Stethoscope,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

export default function CareersPage() {
  return (
    <>
      <PageHero
        eyebrow="Careers"
        title={
          <>
            Build the software{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              India&apos;s travel trade
            </span>{' '}
            actually wants.
          </>
        }
        subtitle={
          <>
            Small team, long-term bets, and customers who tell you the truth. We&apos;re hiring
            across engineering, design, trade, and partnerships — based in Mumbai, remote-friendly
            for senior roles.
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <a href="#roles">
                See open roles <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="mailto:careers@tripbng.com">
                <Mail className="h-4 w-4" /> careers@tripbng.com
              </a>
            </Button>
          </>
        }
      />

      <Culture />
      <Perks />
      <Roles />
      <Process />
    </>
  );
}

// ───────────────────── Culture ─────────────────────

const CULTURE = [
  {
    title: 'Ship close to the metal',
    body:
      'Every engineer writes the code, owns the deploy, and watches the metrics. Median PR-to-prod is under 2 hours.',
  },
  {
    title: 'Talk to agents weekly',
    body:
      'Product, design, and engineering all rotate through partner calls. Specs that have never met a customer don\'t ship.',
  },
  {
    title: 'Async by default, sharp when needed',
    body:
      'Long-form RFCs over standups. Real-time only when the on-call pager fires.',
  },
  {
    title: 'Hire for taste',
    body:
      'We over-index on people who care about the third decimal place — invoices that align, lists that sort right, copy that doesn\'t lie.',
  },
];

function Culture() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">How we work</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Four things you&apos;ll feel in your first week.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {CULTURE.map((c, i) => (
            <Reveal key={c.title} delay={i * 60}>
              <Card className="h-full p-6">
                <h3 className="text-lg font-bold tracking-tight text-ink-1">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{c.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── Perks ─────────────────────

const PERKS = [
  { icon: Stethoscope, label: 'Health cover', desc: 'For you, partner, and 2 children — including parents.' },
  { icon: Home, label: 'Hybrid', desc: '3 days in Bandra, 2 anywhere. Remote-only for senior eng.' },
  { icon: Plane, label: 'Travel credit', desc: '₹40,000/year on TripBng for personal trips.' },
  { icon: Laptop, label: 'Your kit', desc: 'M-series MacBook + a chair that doesn\'t kill your back.' },
  { icon: Sun, label: 'Time off', desc: '24 paid leaves, 12 sick, all gazetted holidays, no questions.' },
  { icon: Coffee, label: 'Learning', desc: '₹50,000/year on books, courses, or a conference.' },
];

function Perks() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Benefits</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Treats grown-ups like grown-ups.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERKS.map((p, i) => (
            <Reveal key={p.label} delay={i * 50}>
              <Card className="h-full p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <p.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-ink-1">{p.label}</h3>
                    <p className="mt-1 text-sm text-ink-3">{p.desc}</p>
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

// ───────────────────── Roles ─────────────────────

const ROLES = [
  { team: 'Engineering', title: 'Senior backend engineer · Booking', location: 'Mumbai / Remote', type: 'Full-time' },
  { team: 'Engineering', title: 'Frontend engineer · Dashboard', location: 'Mumbai', type: 'Full-time' },
  { team: 'Engineering', title: 'Senior infra engineer · SRE', location: 'Mumbai / Remote', type: 'Full-time' },
  { team: 'Engineering', title: 'Mobile engineer · React Native', location: 'Mumbai', type: 'Full-time' },
  { team: 'Design', title: 'Product designer · Booking flows', location: 'Mumbai', type: 'Full-time' },
  { team: 'Design', title: 'Brand designer', location: 'Mumbai', type: 'Contract' },
  { team: 'Trade', title: 'Trade desk · Hindi + English', location: 'Mumbai · Lucknow', type: 'Full-time' },
  { team: 'Trade', title: 'Trade desk · Tamil + English', location: 'Chennai', type: 'Full-time' },
  { team: 'Partnerships', title: 'Distributor success manager · North', location: 'Delhi', type: 'Full-time' },
  { team: 'Partnerships', title: 'Distributor success manager · South', location: 'Bengaluru', type: 'Full-time' },
  { team: 'Finance', title: 'Senior accountant · Reconciliation', location: 'Mumbai', type: 'Full-time' },
  { team: 'Operations', title: 'KYC analyst', location: 'Mumbai', type: 'Full-time' },
  { team: 'Operations', title: 'Compliance officer · DPDP', location: 'Mumbai', type: 'Full-time' },
  { team: 'People', title: 'People ops manager', location: 'Mumbai', type: 'Full-time' },
];

function Roles() {
  return (
    <section id="roles" className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Open roles</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            14 seats. All filled before December.
          </h2>
        </Reveal>
        <div className="mt-10 overflow-hidden rounded-xl border bg-surface-1">
          <div className="grid grid-cols-12 border-b bg-surface-2 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
            <div className="col-span-3 hidden sm:block">Team</div>
            <div className="col-span-12 sm:col-span-5">Role</div>
            <div className="col-span-7 hidden sm:block sm:col-span-3">Location</div>
            <div className="col-span-5 hidden sm:block sm:col-span-1 text-right">Type</div>
          </div>
          {ROLES.map((r, i) => (
            <a
              key={r.title}
              href={`mailto:careers@tripbng.com?subject=${encodeURIComponent(r.title)}`}
              className={`group grid grid-cols-12 items-center gap-2 px-6 py-4 text-sm transition-colors hover:bg-surface-2 ${
                i !== ROLES.length - 1 ? 'border-b' : ''
              }`}
            >
              <div className="col-span-3 hidden sm:block">
                <Badge variant="brand" className="font-normal">
                  {r.team}
                </Badge>
              </div>
              <div className="col-span-12 sm:col-span-5">
                <p className="font-semibold text-ink-1 group-hover:text-brand-700">{r.title}</p>
                <p className="mt-0.5 text-xs text-ink-3 sm:hidden">
                  {r.team} · {r.location} · {r.type}
                </p>
              </div>
              <div className="col-span-7 hidden sm:flex sm:col-span-3 items-center gap-1.5 text-ink-3">
                <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                {r.location}
              </div>
              <div className="col-span-5 hidden sm:block sm:col-span-1 text-right text-ink-3">
                {r.type}
              </div>
            </a>
          ))}
        </div>
        <Reveal className="mt-6 text-center">
          <p className="text-sm text-ink-3">
            Don&apos;t see your role?{' '}
            <a
              href="mailto:careers@tripbng.com"
              className="font-semibold text-brand-700 hover:underline"
            >
              Email us your story
            </a>{' '}
            — we hire ahead for taste.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ───────────────────── Process ─────────────────────

const STEPS = [
  { icon: Mail, title: 'Apply', desc: 'Resume + 3 sentences on what you\'re bored of in your current gig.' },
  { icon: HeartHandshake, title: 'Conversation', desc: '45 minutes with the hiring manager. No HR screen.' },
  { icon: Briefcase, title: 'Take-home', desc: 'Real problem from the codebase. ~4 hours. We pay for your time.' },
  { icon: TrendingUp, title: 'Decision', desc: 'Yes/no within 5 working days of the final round.' },
];

function Process() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Process</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Two-week loop. No theatrics.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 70}>
              <Card className="h-full p-6">
                <p className="font-mono text-xs font-bold text-brand-600">0{i + 1}</p>
                <span className="mt-2 grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <s.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-3 text-base font-bold tracking-tight text-ink-1">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-3">{s.desc}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
