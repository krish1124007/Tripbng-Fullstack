'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  CloudOff,
  Fingerprint,
  Plane,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Wallet,
  Wifi,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

const FEATURES = [
  { icon: Search, title: 'Search', body: 'Series + LCC + FSC on one ranked list. Same engine as the web — same results, smaller screen.' },
  { icon: Clock, title: 'Holds', body: 'Lock a fare for 30 minutes. Resume on web later if needed.' },
  { icon: Send, title: 'Ticket', body: 'PNR + e-ticket within seconds. WhatsApp delivery to the pax tap-and-done.' },
  { icon: Wallet, title: 'Wallet', body: 'Real-time balance, top up by UPI in 3 taps, statements export as PDF.' },
  { icon: Bell, title: 'Alerts', body: 'Schedule changes, refund credits, ticketing failures — push + WhatsApp.' },
  { icon: Fingerprint, title: 'Biometric login', body: 'Face ID or fingerprint. 2FA stays on for super-admins.' },
];

const RELIABILITY = [
  { icon: Wifi, title: 'Works on 4G', body: 'Tested on Jio and Airtel base layers in tier-3 cities. Median search under 2.4s.' },
  { icon: CloudOff, title: 'Offline holds', body: 'Already-held PNRs keep their countdown even when the connection drops.' },
  { icon: ShieldCheck, title: 'DPDP compliant', body: 'PII encrypted at rest in Keychain / Keystore. Audit-grade logging.' },
];

export default function MobilePage() {
  return (
    <>
      <PageHero
        eyebrow="Mobile app"
        title={
          <>
            Your counter,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              in your pocket.
            </span>
          </>
        }
        subtitle={
          <>
            Search, hold, ticket, top up — every workflow you run on the dashboard, on a phone with
            a 4G connection. Built for the field, the wedding-week chaos, and the agent walking
            into a partner office to close.
          </>
        }
        actions={
          <>
            <Button asChild size="lg" variant="secondary" disabled>
              <a href="#waitlist">
                <Smartphone className="h-4 w-4" /> Coming to Play Store
              </a>
            </Button>
            <Button asChild size="lg" variant="secondary" disabled>
              <a href="#waitlist">
                <Smartphone className="h-4 w-4" /> Coming to App Store
              </a>
            </Button>
          </>
        }
        aside={<PhoneMock />}
      />

      <Features />
      <Reliability />
      <Waitlist />
    </>
  );
}

function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Phone shell */}
      <div className="relative aspect-[9/19] rounded-[2.4rem] border-[10px] border-ink-1 bg-gradient-to-br from-brand-50 via-surface-1 to-accent-50/40 shadow-2xl">
        {/* Notch */}
        <span className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-ink-1" />
        {/* Screen content */}
        <div className="absolute inset-0 overflow-hidden rounded-[1.6rem] p-4 pt-8">
          <div className="mt-4 flex items-center justify-between">
            <p className="font-mono text-[10px] text-ink-3">9:41</p>
            <Badge variant="brand" className="text-[9px]">
              LIVE
            </Badge>
          </div>
          <h3 className="mt-3 text-lg font-bold text-ink-1">Search flights</h3>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border bg-surface-1 px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-4">From</p>
              <p className="text-sm font-bold text-ink-1">BOM · Mumbai</p>
            </div>
            <div className="rounded-lg border bg-surface-1 px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-4">To</p>
              <p className="text-sm font-bold text-ink-1">DEL · Delhi</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-surface-1 px-3 py-2">
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Date</p>
                <p className="text-xs font-bold text-ink-1">22 Aug</p>
              </div>
              <div className="rounded-lg border bg-surface-1 px-3 py-2">
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Pax</p>
                <p className="text-xs font-bold text-ink-1">1 Adult</p>
              </div>
            </div>
            <button className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 px-3 py-2.5 text-xs font-bold text-white shadow-brand">
              Search <Plane className="h-3 w-3" />
            </button>
          </div>
          {/* Result preview */}
          <div className="mt-4 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">412 results</p>
            <div className="rounded-lg border bg-surface-1 p-2.5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] font-bold text-brand-600">6E 5081</p>
                <Badge variant="brand" className="text-[9px]">
                  Cheapest
                </Badge>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[11px] text-ink-2">07:25 → 09:35</p>
                <p className="font-mono text-sm font-bold text-ink-1">₹4,289</p>
              </div>
            </div>
            <div className="rounded-lg border bg-surface-1 p-2.5">
              <p className="font-mono text-[10px] font-bold text-brand-600">AI 887</p>
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[11px] text-ink-2">08:10 → 10:25</p>
                <p className="font-mono text-sm font-bold text-ink-1">₹4,612</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Every workflow</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Same engine. Smaller screen. Faster taps.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 60}>
              <Card interactive className="h-full p-6">
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-600">
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

function Reliability() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Reliability</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Built for the third bar of signal.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {RELIABILITY.map((r, i) => (
            <Reveal key={r.title} delay={i * 70}>
              <Card className="h-full p-6">
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <r.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{r.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Waitlist() {
  return (
    <section id="waitlist" className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 text-center lg:px-8">
        <Reveal>
          <Badge variant="accent" pulse dot>
            Beta · invite-only
          </Badge>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-4 text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Apps drop in October.
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-3">
            Until then, the web app at <Link href="/login" className="font-semibold text-brand-700 hover:underline">login</Link> is
            fully mobile-optimised — same shortcuts, same feel, no install needed. Scan to open on
            your phone:
          </p>
        </Reveal>
        <Reveal delay={240} className="mt-8 flex justify-center">
          <Card className="grid place-items-center p-6">
            <span className="grid h-32 w-32 place-items-center rounded-lg bg-surface-2">
              <QrCode className="h-24 w-24 text-ink-2" strokeWidth={1.5} />
            </span>
            <p className="mt-3 font-mono text-[11px] text-ink-3">tripbng.com/login</p>
          </Card>
        </Reveal>
        <Reveal delay={320} className="mt-8">
          <Button asChild size="lg">
            <Link href="/login">
              Open dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <p className="mt-3 text-xs text-ink-3 flex items-center justify-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            Add to home screen to launch like a native app
          </p>
        </Reveal>
      </div>
    </section>
  );
}
