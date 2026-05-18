'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cloud,
  Database,
  Globe,
  Mail,
  RefreshCw,
  Server,
  Shield,
  Webhook,
  Wifi,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

// All values are seeded for the marketing page — when the real status backend
// lands, swap to a fetched payload. The shape stays the same so the
// component is a drop-in renderer.

const SYSTEMS = [
  { name: 'Booking engine', desc: 'Search + hold + ticket', status: 'operational', icon: Server, latencyMs: 142, uptime90: 99.98 },
  { name: 'Wallet ledger', desc: 'Top-ups + atomic debits', status: 'operational', icon: Database, latencyMs: 38, uptime90: 99.99 },
  { name: 'Distributor cockpit', desc: 'Earnings + drill-downs', status: 'operational', icon: Activity, latencyMs: 88, uptime90: 99.97 },
  { name: 'Webhooks', desc: 'Lifecycle + payment events', status: 'operational', icon: Webhook, latencyMs: 65, uptime90: 99.95 },
  { name: 'Supplier APIs', desc: 'Series + LCC + FSC + GDS', status: 'degraded', icon: Cloud, latencyMs: 412, uptime90: 99.62 },
  { name: 'Authentication', desc: 'Login + 2FA + key rotation', status: 'operational', icon: Shield, latencyMs: 24, uptime90: 99.99 },
];

const INCIDENTS = [
  {
    title: 'Elevated latency on AirIQ search',
    severity: 'minor',
    when: '2026-05-14 14:08 IST',
    state: 'monitoring',
    note: 'AirIQ upstream returning p95 ~2.4s vs nominal 800ms. Searches re-route to alternate carriers; no booking impact. Vendor RCA pending.',
  },
  {
    title: 'TBO sandbox auth degraded (test env only)',
    severity: 'minor',
    when: '2026-05-10 09:32 IST',
    state: 'resolved',
    note: 'TBO sandbox briefly returned 401 on Authenticate. Production traffic unaffected. Cause: vendor key rotation; we rotated and re-cached.',
  },
  {
    title: 'Webhook delivery delays during maintenance window',
    severity: 'major',
    when: '2026-04-28 02:15 IST',
    state: 'resolved',
    note: 'Scheduled DB failover ran long. Webhook queue depth peaked at ~3,000. All deliveries flushed within 22 minutes. No data loss.',
  },
];

const STATUS_LABEL: Record<string, { text: string; tone: 'success' | 'warn' | 'danger' }> = {
  operational: { text: 'Operational', tone: 'success' },
  degraded: { text: 'Degraded', tone: 'warn' },
  outage: { text: 'Outage', tone: 'danger' },
};

const SEV_LABEL: Record<string, { text: string; tone: 'warn' | 'danger' }> = {
  minor: { text: 'Minor', tone: 'warn' },
  major: { text: 'Major', tone: 'danger' },
};

const allOk = SYSTEMS.every((s) => s.status === 'operational');

export default function StatusPage() {
  return (
    <>
      <PageHero
        eyebrow="System status"
        title={
          allOk ? (
            <>
              All systems{' '}
              <span className="bg-gradient-to-r from-green-500 to-emerald-600 bg-clip-text text-transparent">
                operational.
              </span>
            </>
          ) : (
            <>
              Most systems operational —{' '}
              <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
                one supplier degraded.
              </span>
            </>
          )
        }
        subtitle={
          <>
            Live operational health of every customer-facing system. Latency p95 + 90-day uptime
            shown for each. Subscribe below to get incidents delivered before the trade desk picks
            up the phone.
          </>
        }
        actions={
          <>
            <Button asChild size="lg" variant="secondary">
              <a href="#subscribe">
                <Mail className="h-4 w-4" /> Subscribe to incidents
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/help">
                <RefreshCw className="h-4 w-4" /> What if something breaks?
              </Link>
            </Button>
          </>
        }
      />

      <Overall />
      <Systems />
      <Uptime />
      <Incidents />
      <Subscribe />
    </>
  );
}

function Overall() {
  return (
    <section className="bg-surface-1 py-12">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <span
              className={`live-dot ${allOk ? 'bg-success text-success' : 'bg-warning text-warning'}`}
            />
            <div>
              <p className="text-lg font-bold text-ink-1">
                {allOk ? 'All systems operational' : '5 of 6 systems operational'}
              </p>
              <p className="text-xs text-ink-3 font-mono">
                Last updated · {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Mumbai · ap-south-1
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Refreshes every 60s
            </span>
          </div>
        </Card>
      </div>
    </section>
  );
}

function Systems() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Services</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Health by service.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SYSTEMS.map((s, i) => {
            const stat = STATUS_LABEL[s.status]!;
            const toneCls =
              stat.tone === 'success'
                ? 'bg-success/15 text-success'
                : stat.tone === 'warn'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-danger/15 text-danger';
            return (
              <Reveal key={s.name} delay={i * 50}>
                <Card className="h-full p-5">
                  <div className="flex items-start justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                      <s.icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${toneCls}`}>
                      <span className="live-dot bg-current" />
                      {stat.text}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-bold tracking-tight text-ink-1">{s.name}</h3>
                  <p className="text-xs text-ink-3">{s.desc}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-4">
                        Latency p95
                      </p>
                      <p className="mt-1 font-mono font-bold text-ink-1">{s.latencyMs} ms</p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-4">
                        Uptime 90d
                      </p>
                      <p className="mt-1 font-mono font-bold text-ink-1">{s.uptime90.toFixed(2)}%</p>
                    </div>
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Uptime() {
  // Build a fake 90-day uptime strip — 90 cells with mostly green, a few
  // amber for the degraded incidents. Read-only marketing aesthetic.
  const cells = Array.from({ length: 90 }, (_, i) => {
    if (i === 87 || i === 76) return 'warn'; // recent incidents
    if (i === 60) return 'danger';
    return 'ok';
  });
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Last 90 days</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Three blips in 90 days. None affected booking.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <Card className="mt-8 p-6">
            <p className="font-mono text-xs text-ink-3">
              90 days · {new Date(Date.now() - 89 * 86400e3).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} → today
            </p>
            <div className="mt-4 grid grid-cols-[repeat(90,minmax(0,1fr))] gap-[3px]">
              {cells.map((c, i) => (
                <span
                  key={i}
                  className={`h-9 rounded-sm ${
                    c === 'ok'
                      ? 'bg-success/80 hover:bg-success'
                      : c === 'warn'
                        ? 'bg-warning/80 hover:bg-warning'
                        : 'bg-danger/80 hover:bg-danger'
                  } transition-colors`}
                  title={c === 'ok' ? 'All systems operational' : c === 'warn' ? 'Degraded' : 'Outage'}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-success/80" /> Operational
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-warning/80" /> Degraded
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-danger/80" /> Outage
              </span>
              <span className="ml-auto font-mono">Overall uptime · 99.94%</span>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function Incidents() {
  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Recent incidents</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Postmortems within 48 hours of resolution.
          </h2>
        </Reveal>
        <div className="mt-10 space-y-4">
          {INCIDENTS.map((inc, i) => {
            const sev = SEV_LABEL[inc.severity]!;
            return (
              <Reveal key={inc.title} delay={i * 60}>
                <Card className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            sev.tone === 'warn'
                              ? 'bg-warning/15 text-warning'
                              : 'bg-danger/15 text-danger'
                          }`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {sev.text}
                        </span>
                        <Badge variant="brand" className="font-normal">
                          {inc.state}
                        </Badge>
                      </div>
                      <h3 className="mt-2 text-base font-bold text-ink-1">{inc.title}</h3>
                      <p className="mt-0.5 font-mono text-xs text-ink-3">{inc.when}</p>
                    </div>
                    {inc.state === 'resolved' ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <RefreshCw className="h-5 w-5 text-warning" />
                    )}
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-ink-2">{inc.note}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Subscribe() {
  return (
    <section id="subscribe" className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 text-center lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Subscribe</p>
          <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Know before the trade desk picks up.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-3">
            Incident notifications via email, SMS, or webhook. Pick the channels you actually
            check.
          </p>
        </Reveal>
        <Reveal delay={160} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <a href="mailto:status-subscribe@tripbng.com?subject=Subscribe%20to%20incidents">
              <Mail className="h-4 w-4" /> Email me
            </a>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/api#webhooks">
              <Webhook className="h-4 w-4" /> Webhook
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <a href="https://twitter.com/tripbng" target="_blank" rel="noreferrer">
              <Wifi className="h-4 w-4" /> Follow @tripbng
            </a>
          </Button>
        </Reveal>
        <Reveal delay={240}>
          <Button asChild variant="link" className="mt-6">
            <Link href="/help">
              See what the trade desk does during an incident <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
