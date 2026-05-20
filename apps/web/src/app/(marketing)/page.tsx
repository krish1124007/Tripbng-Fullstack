'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Award,
  BarChart3,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Code,
  CreditCard,
  Gauge,
  HeartHandshake,
  HelpCircle,
  Hotel,
  Layers,
  Lock,
  Mail,
  PhoneCall,
  PlaneTakeoff,
  Receipt,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Target,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { CountUp } from './_components/count-up';
import { Reveal } from './_components/reveal';
import { FauxDashboard } from './_components/faux-dashboard';

export const dynamic = 'force-static';

export default function LandingPage() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <Why />
      <Flow />
      <Network />
      <Roles />
      <Testimonials />
      <MobileAppBand />
      <Resources />
      <Faq />
      <FinalCta />
    </>
  );
}

// ───────────────────── HERO ─────────────────────

function Hero() {
  return (
    <section className="bg-brand-aurora relative overflow-hidden pb-24 pt-28 lg:pb-36 lg:pt-36">
      {/* Floating glow orbs — drift behind the mesh aurora to give the panel
          real motion without overwhelming the foreground. Three sizes /
          colors at varied animation speeds so the pattern never feels
          synced; mix-blend-screen keeps them glowing against the aurora. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-10 h-[28rem] w-[28rem] rounded-full bg-brand-400/35 opacity-70 blur-3xl mix-blend-screen animate-float-orb"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-1/3 h-[26rem] w-[26rem] rounded-full bg-accent-400/30 opacity-60 blur-3xl mix-blend-screen animate-float-orb-slow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/3 h-[22rem] w-[22rem] rounded-full bg-fuchsia-400/20 opacity-50 blur-3xl mix-blend-screen animate-float-orb"
        style={{ animationDelay: '-3s' }}
      />

      {/* Subtle film over the mesh so foreground reads */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/25" />
      {/* Noise overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>")',
        }}
      />

      <div className="relative mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:px-8">
        <div>
          <Reveal>
            <Badge variant="accent" dot pulse className="bg-white/15 text-accent-300 border-white/15 backdrop-blur">
              <Sparkles className="h-3 w-3" />
              New · Series fares for Q3 schedule
            </Badge>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-5 text-display-2 font-bold leading-[1.02] tracking-tight text-balance text-white lg:text-[72px]">
              Run your agency on the rails
              <br />
              <span className="animate-text-shine bg-gradient-to-r from-accent-300 via-amber-200 to-accent-300 bg-clip-text text-transparent">
                the platforms wish
              </span>{' '}
              they had.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80 lg:text-lg">
              One screen for series, LCC, and FSC fares — re-priced live through your policy and
              markup chain. Atomic wallet, distributor cockpit, GST-clean invoicing. Built for
              India&apos;s travel trade.
            </p>
          </Reveal>
          <Reveal delay={240} className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="xl" className="shadow-brand">
              <Link href="/login">
                Sign in to your dashboard <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="ghost"
              className="border border-white/30 bg-white/5 text-white backdrop-blur hover:bg-white/15 hover:text-white"
            >
              <a href="#apply">
                Apply to partner <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </Reveal>

          <Reveal delay={320} className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatChip
              value={<CountUp to={12400} suffix="+" />}
              label="Travel agencies"
            />
            <StatChip
              value={<CountUp to={84} prefix="₹" suffix=" Cr" />}
              label="Monthly GMV"
            />
            <StatChip
              value={<CountUp to={420} />}
              label="Cities served"
            />
            <StatChip
              value={<CountUp to={35} />}
              label="Airlines + suppliers"
            />
          </Reveal>
        </div>

        <Reveal delay={120} className="lg:justify-self-end">
          <FauxDashboard />
        </Reveal>
      </div>
    </section>
  );
}

function StatChip({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 backdrop-blur">
      <p className="font-mono text-lg font-bold tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
        {label}
      </p>
    </div>
  );
}

// ───────────────────── TRUST STRIP ─────────────────────

const AIRLINES = [
  '6E', 'AI', 'UK', 'SG', 'I5', 'QP', 'G8', 'IX', 'EK', 'QR', 'EY', 'SQ',
  'TG', 'CX', 'BA', 'LH', 'AF', 'TK', 'MH', 'ET',
];

function TrustStrip() {
  // Duplicate the list so the marquee can translate -50% for a seamless loop
  // (the second half slides in just as the first half slides out).
  const rolling = [...AIRLINES, ...AIRLINES];
  return (
    <section className="relative border-y bg-surface-1 py-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <p className="shrink-0 text-sm font-semibold text-ink-2 lg:max-w-xs">
            Plugged into India&apos;s scheduled and chartered carriers, plus the world&apos;s top
            GDS aggregators.
          </p>
          {/* Marquee wrapper — overflow hidden + gradient fade masks on the
              left/right edges so codes scroll out cleanly instead of clipping. */}
          <div
            className="relative w-full overflow-hidden"
            style={{
              maskImage:
                'linear-gradient(to right, transparent 0, black 8%, black 92%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to right, transparent 0, black 8%, black 92%, transparent 100%)',
            }}
          >
            <div className="flex w-max gap-3 animate-marquee">
              {rolling.map((a, i) => (
                <div
                  key={`${a}-${i}`}
                  className="grid h-12 w-[68px] shrink-0 place-items-center rounded-md border bg-surface-1 font-mono text-sm font-bold text-ink-3 transition-colors hover:border-brand-300 hover:text-brand-700"
                >
                  {a}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────────────────── WHY TRIPBNG ─────────────────────

const FEATURES = [
  {
    icon: Layers,
    title: 'Series + GDS in one search',
    body:
      'Net rates, contracted overrides, and live aggregator inventory on one ranked list — with a Cheapest / Fastest / Best-value ribbon so the right answer is one glance away.',
  },
  {
    icon: Wallet,
    title: 'Real-time wallet, atomic ledger',
    body:
      'Every debit and credit is a journal entry. Top up via UPI, NEFT, or credit. Statements auto-generate. Zero reconciliation drift, ever.',
  },
  {
    icon: BarChart3,
    title: 'Distributor cockpit',
    body:
      'Earnings trend by day, override commissions, dormant-agency alerts with one-click nudge. Stripe-grade visualisations on real data.',
  },
  {
    icon: Receipt,
    title: 'GST-clean invoicing',
    body:
      'Invoices, e-tickets, credit notes, and debit notes generate themselves — accountant-ready. PAN/GSTIN validated at booking time.',
  },
  {
    icon: Smartphone,
    title: 'Mobile-first ops',
    body:
      'Bottom-nav app for the field. Search, hold, ticket, top up — all from a phone with a 4G connection. Built for travel-week chaos.',
  },
  {
    icon: HeartHandshake,
    title: '24×7 trade desk',
    body:
      'Phone, email, and in-app chat in Hindi, English, Marathi, and Tamil. Median first response under 90 seconds, not hours.',
  },
];

function Why() {
  return (
    <section id="why" className="bg-surface-0 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Why TripBng</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            The platform agents asked for, not the one platforms tried to sell.
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-3">
            Six things make a travel platform feel like a tool, not a tax. We built every one
            from scratch with India&apos;s travel trade in mind.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 60}>
              <Card interactive className="h-full p-6">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <f.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{f.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── FLOW ─────────────────────

const FLOW = [
  { icon: PlaneTakeoff, label: 'Search', desc: 'Series + LCC + FSC, one list.' },
  { icon: Clock, label: 'Hold', desc: 'Lock the fare for 30 minutes.' },
  { icon: CreditCard, label: 'Pay', desc: 'Wallet debit or gateway UPI.' },
  { icon: Send, label: 'Ticket', desc: 'PNR + e-ticket within seconds.' },
  { icon: Receipt, label: 'Invoice', desc: 'GST-clean, accountant-ready.' },
  { icon: CircleDollarSign, label: 'Settle', desc: 'Reconciled the same day.' },
];

function Flow() {
  return (
    <section className="bg-surface-1 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">End-to-end</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Search to settlement in one place — and one ledger.
          </h2>
        </Reveal>

        <div className="relative mt-14">
          {/* Connecting line */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-brand-200 via-brand-400 to-brand-200 lg:block"
          />
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {FLOW.map((s, i) => (
              <Reveal key={s.label} delay={i * 70}>
                <div className="relative flex flex-col items-center text-center">
                  <span className="relative grid h-[72px] w-[72px] place-items-center rounded-full border bg-surface-1 text-brand-600 shadow-sm">
                    <s.icon className="h-6 w-6" strokeWidth={1.75} />
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                      0{i + 1}
                    </span>
                  </span>
                  <h3 className="mt-4 text-base font-bold text-ink-1">{s.label}</h3>
                  <p className="mt-1 max-w-[14ch] text-xs leading-relaxed text-ink-3">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────────────────── NETWORK ─────────────────────

function Network() {
  return (
    <section id="network" className="bg-surface-0 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <Reveal>
              <p className="eyebrow text-brand-600">Network reach</p>
              <h2 className="mt-2 max-w-xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
                Plugged into the network your customers already trust.
              </h2>
              <p className="mt-3 max-w-md text-base leading-relaxed text-ink-3">
                Domestic and international airlines, hotel chains, payment partners — wired in
                at the metal layer so prices are live, not cached.
              </p>
            </Reveal>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <NetworkTile
                icon={PlaneTakeoff}
                value={<CountUp to={35} />}
                label="Airlines"
                tone="brand"
              />
              <NetworkTile icon={Hotel} value={<CountUp to={140} />} label="Hotel chains" />
              <NetworkTile
                icon={CreditCard}
                value={<CountUp to={9} />}
                label="Payment partners"
                tone="accent"
              />
            </div>
          </div>

          {/* Map illustration — simplified India outline with pulsing brand-blue dots */}
          <Reveal delay={120}>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-brand-50 via-surface-1 to-accent-50/40 p-6 shadow-sm">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                420 cities · live coverage
              </p>
              <svg
                viewBox="0 0 400 320"
                className="absolute inset-0 h-full w-full"
                aria-hidden
              >
                <defs>
                  <radialGradient id="dot-glow" cx="50%" cy="50%">
                    <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* Stylised dot grid suggesting India's coverage; not a real map */}
                {[
                  [120, 70, 'BOM'],
                  [220, 60, 'DEL'],
                  [180, 130, 'IND'],
                  [240, 140, 'HYD'],
                  [300, 200, 'CCU'],
                  [180, 220, 'BLR'],
                  [220, 250, 'MAA'],
                  [120, 200, 'GOI'],
                  [80, 130, 'AMD'],
                  [320, 80, 'GAU'],
                  [160, 60, 'JAI'],
                  [260, 200, 'TIR'],
                ].map(([x, y, code]) => (
                  <g key={code as string}>
                    <circle cx={x as number} cy={y as number} r="22" fill="url(#dot-glow)" />
                    <circle
                      cx={x as number}
                      cy={y as number}
                      r="3.5"
                      fill="var(--brand-600)"
                    />
                    <text
                      x={(x as number) + 8}
                      y={(y as number) + 4}
                      fontFamily="var(--font-jetbrains)"
                      fontSize="10"
                      fontWeight="600"
                      fill="var(--ink-2)"
                    >
                      {code as string}
                    </text>
                  </g>
                ))}
                {/* Top-5 hot routes accent */}
                <line
                  x1="120"
                  y1="70"
                  x2="220"
                  y2="60"
                  stroke="var(--accent-500)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.65"
                />
                <line
                  x1="180"
                  y1="220"
                  x2="220"
                  y2="60"
                  stroke="var(--accent-500)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.65"
                />
                <line
                  x1="180"
                  y1="220"
                  x2="120"
                  y2="70"
                  stroke="var(--accent-500)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.65"
                />
              </svg>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function NetworkTile({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof PlaneTakeoff;
  value: React.ReactNode;
  label: string;
  tone?: 'brand' | 'accent';
}) {
  return (
    <Card
      tone={tone === 'brand' ? 'brand' : 'default'}
      className="p-5"
    >
      <div className="flex items-start justify-between">
        <p className="eyebrow text-ink-3">{label}</p>
        <span
          className={`grid h-8 w-8 place-items-center rounded-md ${
            tone === 'brand'
              ? 'bg-brand-100 text-brand-700'
              : tone === 'accent'
                ? 'bg-accent-100 text-accent-700'
                : 'bg-surface-2 text-ink-3'
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>
      <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-ink-1">{value}</p>
    </Card>
  );
}

// ───────────────────── ROLES ─────────────────────

const ROLES = [
  {
    icon: Building2,
    title: 'Agency owners',
    blurb: 'Run a tighter shop with a transparent ledger and one workflow.',
    bullets: [
      'Atomic wallet with credit limits',
      'Real-time GMV + earnings',
      'Sub-agent permissions, fully RBAC',
      'GST-clean invoicing on autopilot',
    ],
    cta: 'Sign in to your dashboard',
    href: '/login',
    featured: false,
  },
  {
    icon: BarChart3,
    title: 'Distributors',
    blurb: 'A cockpit that finally shows you what your network is doing.',
    bullets: [
      'Earnings trend, override commissions',
      'Dormant-agency alerts with nudges',
      'Top-N agency leaderboard',
      'Lifetime GMV + per-agency drill-down',
    ],
    cta: 'Open the cockpit',
    href: '/login',
    featured: true,
  },
  {
    icon: Users,
    title: 'Sub-agents',
    blurb: 'A clean, mobile-first console that respects your time.',
    bullets: [
      'Field-ready mobile flow',
      'Saved routes for quick rebook',
      'In-app holds + ticketing',
      'Personal performance scoreboard',
    ],
    cta: 'Get the mobile app',
    href: '/login',
    featured: false,
  },
];

function Roles() {
  return (
    <section id="roles" className="bg-surface-1 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">For every role</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            One platform, three jobs done well.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3 lg:gap-6">
          {ROLES.map((r, i) => (
            <Reveal key={r.title} delay={i * 80}>
              {/* Featured cards get a slow conic-rotating gradient ring,
                  built from two stacked layers: an inset-[-2px] wrapper
                  with the rotating conic gradient and an inset Card that
                  masks the interior. Non-featured cards skip the wrapper
                  and render the Card directly so the layout doesn't shift. */}
              {r.featured ? (
                <div className="relative h-full rounded-[18px] p-[2px] lg:scale-[1.04]">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-[18px] opacity-90"
                    style={{
                      background:
                        'conic-gradient(from 0deg, var(--brand-500), var(--accent-500), var(--brand-300), var(--brand-500))',
                      filter: 'blur(6px)',
                      animation: 'spin-slow 12s linear infinite',
                    }}
                  />
                  <Card
                    tone="brand"
                    elevation="raised"
                    className="relative h-full overflow-hidden p-7"
                  >
                    <Badge variant="accent" className="mb-3">
                      <Star className="h-3 w-3" /> Most popular
                    </Badge>
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-100/60 text-brand-700">
                      <r.icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <h3 className="mt-5 text-xl font-bold tracking-tight text-ink-1">{r.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-3">{r.blurb}</p>
                    <ul className="mt-5 space-y-2.5">
                      {r.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-sm text-ink-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    <Button asChild className="mt-7 w-full">
                      <Link href={r.href}>
                        {r.cta} <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </Card>
                </div>
              ) : (
                <Card tone="default" elevation="flat" className="h-full p-7">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-100/60 text-brand-700">
                    <r.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-5 text-xl font-bold tracking-tight text-ink-1">{r.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">{r.blurb}</p>
                  <ul className="mt-5 space-y-2.5">
                    {r.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-sm text-ink-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-7 w-full" variant="soft">
                    <Link href={r.href}>
                      {r.cta} <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </Card>
              )}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── TESTIMONIALS ─────────────────────

const QUOTES = [
  {
    quote:
      'Our reconciliation went from 4 hours every Friday to under 15 minutes. The ledger just adds up. The team gets their evenings back.',
    name: 'Priya Sharma',
    company: 'Sharma Travels, Lucknow',
    code: 'AT-LUC-0142',
  },
  {
    quote:
      'Series fares used to live in WhatsApp groups. Now they live in the search bar. We&apos;ve doubled our charter business in two quarters.',
    name: 'Rahul Mehta',
    company: 'Wanderlust Holidays, Kochi',
    code: 'AT-COK-0309',
  },
  {
    quote:
      'The distributor cockpit caught three dormant agencies in the first week. We re-engaged all three. Worth the platform fee on its own.',
    name: 'Neha Iyer',
    company: 'Pan-India Tours, Bengaluru',
    code: 'DT-BLR-0011',
  },
];

function Testimonials() {
  return (
    <section id="stories" className="bg-surface-1 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Trade voices</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            What partners say after the second month.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3 lg:gap-6">
          {QUOTES.map((q, i) => (
            <Reveal key={q.name} delay={i * 80}>
              <Card className="group relative h-full overflow-hidden p-7 transition-shadow duration-normal hover:shadow-lg">
                {/* Decorative oversized quote glyph — fades behind the
                    content but anchors the card visually. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-2 -top-4 select-none font-serif text-[120px] leading-none text-brand-100/70 transition-colors group-hover:text-brand-100"
                >
                  &ldquo;
                </span>

                <div className="relative">
                  <div className="flex items-center justify-between">
                    <Badge variant="brand">
                      <ShieldCheck className="h-3 w-3" /> Verified partner
                    </Badge>
                    <div className="flex items-center gap-0.5 text-accent-500" aria-label="5 out of 5">
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <Star key={idx} className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                      ))}
                    </div>
                  </div>
                  <p className="mt-4 text-base leading-relaxed text-ink-1 lg:text-[15px]">
                    &ldquo;{q.quote}&rdquo;
                  </p>
                  <div className="mt-6 flex items-center gap-3 border-t pt-4">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow-sm">
                      {q.name
                        .split(' ')
                        .map((s) => s[0])
                        .join('')}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink-1">{q.name}</p>
                      <p className="font-mono text-[11px] text-ink-3">
                        {q.company} · {q.code}
                      </p>
                    </div>
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

// ───────────────────── MOBILE APP BAND ─────────────────────
//
// Coming-soon teaser — the mobile app drops in October. We reuse the
// landing's brand-aurora vocabulary (animated orbs + gradient
// highlight) so this section sits visually between the testimonials
// and resources without breaking the flow.

function MobileAppBand() {
  return (
    <section id="mobile-app" className="bg-surface-0 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ink-1 via-brand-700 to-brand-600 p-8 lg:p-14">
          {/* Drifting orbs + noise — same recipe as the hero, scaled down. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-20 -top-20 h-[24rem] w-[24rem] rounded-full bg-accent-400/35 blur-3xl mix-blend-screen animate-float-orb"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 bottom-0 h-[22rem] w-[22rem] rounded-full bg-brand-400/30 blur-3xl mix-blend-screen animate-float-orb-slow"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
            style={{
              backgroundImage:
                'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>")',
            }}
          />

          <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <Reveal>
                <Badge variant="accent" pulse dot className="bg-white/15 text-accent-300 border-white/15 backdrop-blur">
                  <Smartphone className="h-3 w-3" /> Coming October · invite-only beta
                </Badge>
              </Reveal>
              <Reveal delay={80}>
                <h2 className="mt-5 text-display-2 font-bold leading-[1.05] tracking-tight text-balance text-white lg:text-[56px]">
                  Your counter,{' '}
                  <span className="animate-text-shine bg-gradient-to-r from-accent-300 via-amber-200 to-accent-300 bg-clip-text text-transparent">
                    in your pocket.
                  </span>
                </h2>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-white/80 lg:text-lg">
                  Search, hold, ticket, top up — the full TripBng workflow on a phone with a 4G
                  connection. App Store + Play Store rollout in October; we&apos;ll email beta
                  invites to active partner agencies first.
                </p>
              </Reveal>

              <Reveal delay={240} className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  aria-disabled
                  title="Coming soon"
                  className="group relative inline-flex h-14 items-center gap-3 overflow-hidden rounded-xl bg-black px-5 text-white opacity-95 transition-transform hover:scale-[1.02]"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                    <path d="M16.365 1.43c0 1.14-.46 2.18-1.36 2.96-.91.78-2.07 1.18-3.06 1.1-.12-1.18.42-2.4 1.25-3.17.86-.81 2.07-1.31 3.17-1.34v.45zm3.61 7.6c-.02.4-.78 2.41-2.34 4.49-1.34 1.79-2.74 3.58-4.94 3.62-2.16.04-2.86-1.27-5.34-1.27-2.49 0-3.27 1.23-5.31 1.31-2.13.08-3.75-1.94-5.1-3.73C-5.42 9.39-3.36 4.66.05 4.6c2.06-.04 4 1.39 5.26 1.39 1.26 0 3.59-1.71 6.06-1.46.83.04 3.18.34 4.69 2.55l-2.06 1.2c-1.62.96-3.84 3.05-3.84 6.74 0 4.32 3.77 5.84 3.86 5.87-.03.07-.59 2.04-1.94 4.13z" />
                  </svg>
                  <span className="leading-tight">
                    <span className="block text-[10px] uppercase tracking-wider text-white/60">
                      Download on the
                    </span>
                    <span className="block text-base font-semibold">App Store</span>
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-accent-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow">
                    Soon
                  </span>
                </a>

                <a
                  aria-disabled
                  title="Coming soon"
                  className="group relative inline-flex h-14 items-center gap-3 overflow-hidden rounded-xl bg-black px-5 text-white opacity-95 transition-transform hover:scale-[1.02]"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                    <path d="M3.609 1.814 13.792 12 3.609 22.186a.996.996 0 0 1-.609-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893 2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.198 2.733 1.583a1 1 0 0 1 0 1.726l-2.732 1.582-2.585-2.585 2.584-2.586zM5.864 2.658 16.802 8.99l-2.302 2.303-8.636-8.635z" />
                  </svg>
                  <span className="leading-tight">
                    <span className="block text-[10px] uppercase tracking-wider text-white/60">
                      Get it on
                    </span>
                    <span className="block text-base font-semibold">Google Play</span>
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-accent-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow">
                    Soon
                  </span>
                </a>

                <Button asChild variant="ghost" className="border border-white/30 bg-white/5 text-white backdrop-blur hover:bg-white/15 hover:text-white">
                  <Link href="/mobile">
                    See the app preview <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </Reveal>

              <Reveal delay={320} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/70">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Biometric login
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" /> Works on third-bar 4G
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Same engine as the web
                </span>
              </Reveal>
            </div>

            {/* Phone mockup — purely decorative, inline SVG-ish using divs */}
            <Reveal delay={120} className="lg:justify-self-end">
              <div className="relative mx-auto w-full max-w-[280px]">
                <div className="relative aspect-[9/19] rounded-[2.2rem] border-[8px] border-black/80 bg-gradient-to-br from-brand-50 via-white to-accent-50/40 shadow-2xl">
                  <span aria-hidden className="absolute left-1/2 top-0 z-10 h-5 w-20 -translate-x-1/2 rounded-b-2xl bg-black/80" />
                  <div className="absolute inset-0 overflow-hidden rounded-[1.5rem] p-4 pt-8">
                    <div className="mt-3 flex items-center justify-between">
                      <p className="font-mono text-[10px] text-ink-3">9:41</p>
                      <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[8px] font-bold text-white">LIVE</span>
                    </div>
                    <h3 className="mt-3 text-base font-bold text-ink-1">Search flights</h3>
                    <div className="mt-3 space-y-2">
                      <div className="rounded-lg border bg-white px-3 py-2">
                        <p className="font-mono text-[9px] uppercase tracking-wider text-ink-4">From</p>
                        <p className="text-xs font-bold text-ink-1">BOM · Mumbai</p>
                      </div>
                      <div className="rounded-lg border bg-white px-3 py-2">
                        <p className="font-mono text-[9px] uppercase tracking-wider text-ink-4">To</p>
                        <p className="text-xs font-bold text-ink-1">DEL · Delhi</p>
                      </div>
                      <button className="mt-2 w-full rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 py-2 text-[11px] font-bold text-white shadow">
                        Search →
                      </button>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <div className="rounded-md border bg-white p-2">
                        <div className="flex items-center justify-between">
                          <p className="font-mono text-[9px] font-bold text-brand-600">6E 5081</p>
                          <span className="rounded-full bg-brand-100 px-1 py-0.5 text-[7px] font-bold text-brand-700">Cheapest</span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] font-bold text-ink-1">₹4,289</p>
                      </div>
                      <div className="rounded-md border bg-white p-2">
                        <p className="font-mono text-[9px] font-bold text-brand-600">AI 887</p>
                        <p className="mt-0.5 font-mono text-[11px] font-bold text-ink-1">₹4,612</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────────────────── RESOURCES ─────────────────────

const RESOURCES = [
  {
    icon: Award,
    title: 'Quick-start guide',
    desc: 'Onboarding to first booking in under 24 hours. 9-step playbook.',
    href: '/docs',
  },
  {
    icon: Code,
    title: 'API reference',
    desc: 'Programmatic search, holds, ticketing, and webhooks. OpenAPI 3.1.',
    href: '/api',
  },
  {
    icon: PhoneCall,
    title: 'Trade desk hotline',
    desc: 'Mon–Sun, 24×7. Hindi, English, Marathi, Tamil. 90s response SLA.',
    href: '/help',
  },
];

function Resources() {
  return (
    <section className="bg-surface-0 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Resources</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Everything you need to ship your first ticket.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {RESOURCES.map((r, i) => (
            <Reveal key={r.title} delay={i * 70}>
              <Link
                href={r.href}
                className="group block h-full rounded-xl border bg-surface-1 p-6 transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <r.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{r.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                  Learn more
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── FAQ ─────────────────────

const FAQS = [
  {
    q: 'How long does onboarding take?',
    a: 'Self-serve KYC + GST validation completes in about 24 hours. You can run searches the same day; ticketing opens once KYC is approved.',
  },
  {
    q: 'What KYC documents do you need?',
    a: 'PAN of the proprietor / firm, GSTIN (if registered), business address proof, and IATA / TAFI accreditation if applicable. Everything uploads in-app.',
  },
  {
    q: 'How does the wallet work?',
    a: 'Top up via UPI, NEFT, or credit card. Every booking debits atomically — there is no per-transaction window where your books are out of sync. Statements export to CSV / PDF in one click.',
  },
  {
    q: 'What suppliers do you connect to?',
    a: 'Indian and international scheduled airlines, charter/series operators, the major GDS aggregators, leading hotel chains, and licensed Indian payment processors. The full list is in your dashboard once you onboard.',
  },
  {
    q: 'How does override commission work for distributors?',
    a: 'You configure an override percentage on each agency in your network. Earnings post to your wallet on every ticketed booking — visible in real time in the cockpit.',
  },
  {
    q: 'What happens if a booking fails after payment?',
    a: 'Auto-refund. Our pricing engine is wrapped in an atomic transaction — if ticket issuance fails for any reason, the wallet debit reverses inside the same operation.',
  },
  {
    q: 'Can my sub-agents have separate logins and limits?',
    a: 'Yes. Full RBAC with permission strings (resource:action:scope), individual credit caps, and a per-user audit trail. Permissions inherit from the agency role and can be tightened.',
  },
  {
    q: 'How do I export for Tally / Zoho Books / GST filing?',
    a: 'Built-in: invoices, e-tickets, credit notes, and debit notes export as PDF + structured CSV. JSON export for the Tally GSTR-1 / GSTR-3B fields is one click away.',
  },
  {
    q: 'Is my data secure?',
    a: 'TLS 1.3 in transit, encryption at rest in Atlas, bcrypt password hashing, optional 2FA, mandatory 2FA for super-admin and distributor roles. DPDP Act 2023 compliant; SOC 2 in flight.',
  },
  {
    q: 'How do I get help when something goes wrong?',
    a: 'Phone, email, and in-app chat in 4 languages, 24×7. Median first response under 90 seconds. Critical-path issues escalate to engineering on-call.',
  },
];

function Faq() {
  return (
    <section id="faq" className="bg-surface-1 py-20 lg:py-28">
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <Reveal className="text-center">
          <p className="eyebrow text-brand-600">Common questions</p>
          <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Things partners ask before they sign up.
          </h2>
        </Reveal>

        <div className="mt-12 divide-y rounded-xl border bg-surface-1">
          {FAQS.map((f, i) => (
            <details
              key={f.q}
              className="group px-6 py-5 [&[open]>summary>svg.plus]:rotate-45 [&[open]>summary>svg.plus]:text-brand-600"
            >
              <summary className="flex cursor-pointer list-none items-start gap-4 outline-none">
                <span className="font-mono text-xs font-bold text-ink-4 mt-1">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="flex-1 text-base font-semibold text-ink-1">{f.q}</h3>
                <Plus className="plus h-4 w-4 shrink-0 text-ink-3 transition-transform duration-fast" />
              </summary>
              <p className="mt-3 max-w-prose pl-9 text-sm leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>

        <Reveal className="mt-10 text-center">
          <p className="text-sm text-ink-3">
            Didn&apos;t find your answer?{' '}
            <a href="mailto:trade@tripbng.com" className="font-semibold text-brand-700 hover:underline">
              <Mail className="-mt-0.5 mr-1 inline h-3.5 w-3.5" /> Email the trade desk
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Plus({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ───────────────────── FINAL CTA ─────────────────────

function FinalCta() {
  return (
    <section id="apply" className="bg-brand-aurora relative overflow-hidden py-20 lg:py-28">
      {/* Floating glow orbs — mirror the hero treatment so the page opens
          and closes on the same visual motif. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-4 h-[24rem] w-[24rem] rounded-full bg-accent-400/30 opacity-70 blur-3xl mix-blend-screen animate-float-orb-slow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-0 h-[22rem] w-[22rem] rounded-full bg-brand-400/35 opacity-70 blur-3xl mix-blend-screen animate-float-orb"
        style={{ animationDelay: '-2s' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/20" />
      <div className="relative mx-auto max-w-5xl px-6 text-center lg:px-8">
        <Reveal>
          <Badge variant="accent" className="bg-white/15 text-accent-300 border-white/15 backdrop-blur">
            <Target className="h-3 w-3" /> Ready when you are
          </Badge>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-5 text-display-2 font-bold tracking-tight text-balance text-white lg:text-[56px]">
            Start booking in 24 hours.
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/80 lg:text-lg">
            Free onboarding. Same-day KYC. No setup fees. Sign in with credentials your distributor
            shared, or apply to partner from scratch.
          </p>
        </Reveal>
        <Reveal delay={240} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="xl" className="shadow-brand">
            <Link href="/login">
              Sign in to your dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="xl"
            variant="ghost"
            className="border border-white/30 bg-white/5 text-white backdrop-blur hover:bg-white/15 hover:text-white"
          >
            <a href="mailto:partner@tripbng.com">
              Apply to partner <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
        </Reveal>
        <Reveal delay={320} className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-white/70">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> DPDP Act 2023 compliant
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> 2FA enforced
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> p95 latency &lt; 200 ms
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5" /> ISO-27001 in flight
          </span>
        </Reveal>
      </div>
    </section>
  );
}
