'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Code2,
  Compass,
  CreditCard,
  FileText,
  GitBranch,
  Lightbulb,
  PlayCircle,
  Receipt,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Webhook,
  Workflow,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

const QUICKSTART = [
  { step: '01', title: 'KYC + GST validation', desc: 'Upload PAN + GSTIN. Approved in ~24h.', icon: ShieldCheck },
  { step: '02', title: 'First wallet top-up', desc: 'UPI / NEFT — credits live in 90 seconds.', icon: Wallet },
  { step: '03', title: 'Add your team', desc: 'Invite sub-agents with per-day credit caps.', icon: Users },
  { step: '04', title: 'First search', desc: 'Series + LCC + FSC on one ranked list.', icon: Compass },
  { step: '05', title: 'First hold + ticket', desc: 'Lock fare 30 min, ticket within seconds.', icon: PlayCircle },
  { step: '06', title: 'Export GST invoices', desc: 'PDF + JSON for GSTR-1, one click.', icon: Receipt },
];

const PLAYBOOKS = [
  {
    icon: Workflow,
    title: 'Onboarding playbook',
    desc: 'Day-by-day plan from sign-up to first ticket. Counter-tested with 11 partner agencies.',
    chips: ['9 steps', '24h to first ticket', 'Hindi + English'],
  },
  {
    icon: Building2,
    title: 'Distributor cockpit playbook',
    desc: 'Wire your network, set override commissions, configure dormancy alerts, run the weekly review.',
    chips: ['12 steps', 'Earnings reports', 'Drill-downs'],
  },
  {
    icon: CreditCard,
    title: 'Refund & reissue handbook',
    desc: 'Every refund path with timelines: airline-driven, GDS-driven, schedule-change, no-show.',
    chips: ['38 scenarios', 'Bank statements', 'Wallet ledger'],
  },
  {
    icon: GitBranch,
    title: 'Series fare loading',
    desc: 'Upload a charter / consolidator contract, define markup rules, run a test booking.',
    chips: ['CSV upload', 'Markup chain', 'Live test'],
  },
];

const REFERENCE = [
  { icon: Code2, title: 'API reference', desc: 'OpenAPI 3.1, request/response examples in cURL + Node + Python.', href: '/api' },
  { icon: Webhook, title: 'Webhooks', desc: 'Booking lifecycle, refunds, payment events. HMAC-signed.', href: '/api#webhooks' },
  { icon: FileText, title: 'Postman collection', desc: '64 endpoints with environments, auth, and assertions baked in.', href: '/api#postman' },
];

export default function DocsPage() {
  return (
    <>
      <PageHero
        eyebrow="Trade docs"
        title={
          <>
            Run your agency on TripBng,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              start to finish.
            </span>
          </>
        }
        subtitle={
          <>
            Playbooks, quick starts, API references, and webhooks — all version-controlled and
            updated alongside every release. Built for ops teams that prefer concrete checklists
            over essays.
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <a href="#quickstart">
                Start with quickstart <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/api">
                API reference <Code2 className="h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

      <Quickstart />
      <Playbooks />
      <ReferenceBlock />
      <FooterTips />
    </>
  );
}

function Quickstart() {
  return (
    <section id="quickstart" className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Quickstart</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Six steps from sign-up to first ticket.
          </h2>
          <p className="mt-3 max-w-xl text-base text-ink-3 flex items-center gap-1.5">
            <Clock className="h-4 w-4" strokeWidth={2} /> ~24 hours end-to-end, mostly waiting on KYC.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {QUICKSTART.map((s, i) => (
            <Reveal key={s.step} delay={i * 50}>
              <Card interactive className="h-full p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-brand-600">{s.step}</span>
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-50 text-brand-600">
                    <s.icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                </div>
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

function Playbooks() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Playbooks</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Step-by-step. Edited weekly.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {PLAYBOOKS.map((p, i) => (
            <Reveal key={p.title} delay={i * 70}>
              <Card interactive className="h-full p-7">
                <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <p.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{p.desc}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.chips.map((c) => (
                    <Badge key={c} variant="brand" className="font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
                <Button asChild variant="link" className="mt-4 -ml-3">
                  <a href="#">
                    Open playbook <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReferenceBlock() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Developer reference</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Programmatic agencies welcome.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {REFERENCE.map((r, i) => (
            <Reveal key={r.title} delay={i * 60}>
              <Link
                href={r.href}
                className="group block h-full rounded-xl border bg-surface-1 p-6 transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md"
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <r.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-base font-bold tracking-tight text-ink-1">{r.title}</h3>
                <p className="mt-1 text-sm text-ink-3">{r.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                  Open
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

function FooterTips() {
  return (
    <section className="bg-surface-0 py-16">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <Card className="grid items-center gap-6 p-7 md:grid-cols-[1fr_auto]">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent-100/60 text-accent-700">
              <Lightbulb className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-ink-1">Docs improving every week.</h3>
              <p className="mt-1 text-sm text-ink-3">
                Got a gap, an unclear bit, or a missing scenario?{' '}
                <a href="mailto:docs@tripbng.com" className="font-semibold text-brand-700 hover:underline">
                  Email docs@tripbng.com
                </a>{' '}
                — we credit contributors in the changelog.
              </p>
              <ul className="mt-3 grid gap-1.5 text-sm text-ink-2 sm:grid-cols-2">
                {['Versioned per release', 'Open changelog', 'Hindi voice-overs coming Q4', 'Searchable across PDFs'].map(
                  (b) => (
                    <li key={b} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2} />
                      {b}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
          <Button asChild>
            <a href="mailto:docs@tripbng.com">
              <Sparkles className="h-4 w-4" /> Suggest an edit
            </a>
          </Button>
        </Card>
      </div>
    </section>
  );
}
