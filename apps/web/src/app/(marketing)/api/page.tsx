'use client';

import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Globe,
  KeyRound,
  Lock,
  Search,
  ShieldCheck,
  Terminal,
  Webhook,
  Zap,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

const ENDPOINTS = [
  { method: 'POST', path: '/api/v1/auth/login', desc: 'Exchange credentials + TOTP for access + refresh tokens.', group: 'Auth' },
  { method: 'POST', path: '/api/v1/auth/refresh', desc: 'Rotate the refresh token; receive a fresh access token.', group: 'Auth' },
  { method: 'POST', path: '/api/v1/search/flights', desc: 'Fan out search across series + LCC + FSC suppliers.', group: 'Search' },
  { method: 'POST', path: '/api/v1/bookings/hold', desc: 'Lock a fare for 30 minutes. Wallet pre-authorised.', group: 'Booking' },
  { method: 'POST', path: '/api/v1/bookings/ticket', desc: 'Ticket a held PNR. Returns ticket numbers + e-ticket URL.', group: 'Booking' },
  { method: 'POST', path: '/api/v1/bookings/:id/cancel', desc: 'Cancel a booking. Refund posts atomically to the wallet.', group: 'Booking' },
  { method: 'GET', path: '/api/v1/wallet/me', desc: 'Real-time wallet balance, credit limit, last 5 transactions.', group: 'Wallet' },
  { method: 'POST', path: '/api/v1/wallet/topups', desc: 'Initiate a UPI / NEFT / bank-transfer top-up.', group: 'Wallet' },
  { method: 'GET', path: '/api/v1/reports/gstr-1', desc: 'Download a month\'s GSTR-1 ready JSON / CSV.', group: 'Reports' },
];

const SDKS = [
  { lang: 'Node.js', version: '0.6.0', install: 'npm i @tripbng/sdk', logo: 'NODE' },
  { lang: 'Python', version: '0.4.2', install: 'pip install tripbng', logo: 'PY' },
  { lang: 'PHP', version: '0.3.1', install: 'composer require tripbng/sdk', logo: 'PHP' },
  { lang: 'Go', version: '0.2.0', install: 'go get github.com/tripbng/sdk-go', logo: 'GO' },
];

export default function ApiPage() {
  return (
    <>
      <PageHero
        eyebrow="API reference"
        title={
          <>
            Build on the same engine{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              the dashboard runs on.
            </span>
          </>
        }
        subtitle={
          <>
            REST API with OpenAPI 3.1 schema, signed webhooks, idempotency keys, and SDKs in Node /
            Python / PHP / Go. p95 latency under 200 ms, 99.97% uptime SLO.
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
              <a href="/openapi.json" download>
                <Download className="h-4 w-4" /> OpenAPI 3.1
              </a>
            </Button>
          </>
        }
      />

      <Highlights />
      <Quickstart />
      <Endpoints />
      <Webhooks />
      <Sdks />
    </>
  );
}

function Highlights() {
  return (
    <section className="bg-surface-1 py-12">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Zap, label: 'p95 latency', value: '< 200 ms' },
            { icon: ShieldCheck, label: 'Uptime SLO', value: '99.97%' },
            { icon: KeyRound, label: 'Idempotency', value: 'On every write' },
            { icon: Globe, label: 'Regions', value: 'ap-south-1 (Mumbai)' },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 50}>
              <Card className="p-5">
                <div className="flex items-center gap-2 text-brand-600">
                  <s.icon className="h-4 w-4" strokeWidth={1.75} />
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider">
                    {s.label}
                  </p>
                </div>
                <p className="mt-2 text-xl font-bold text-ink-1">{s.value}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Quickstart() {
  return (
    <section id="quickstart" className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-16">
          <Reveal>
            <p className="eyebrow text-brand-600">Quickstart</p>
            <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
              Three minutes to your first call.
            </h2>
            <ol className="mt-6 space-y-5">
              {[
                { title: 'Generate an API key', desc: 'Dashboard → Settings → Developers → Create key. Scope it to flights:search if that\'s all you need.' },
                { title: 'Authenticate', desc: 'Pass the key as Bearer in the Authorization header. Rotate keys without downtime — two keys can be live at once.' },
                { title: 'Make a call', desc: 'POST /api/v1/search/flights with a SearchRequest body. Response is a SearchResponse with ranked results across suppliers.' },
              ].map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 font-mono text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-ink-1">{s.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-3">{s.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal delay={120}>
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b bg-surface-2 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-ink-3" />
                  <p className="font-mono text-xs font-semibold text-ink-2">curl · first search</p>
                </div>
                <Badge variant="brand" className="font-normal">
                  v1
                </Badge>
              </div>
              <pre className="overflow-x-auto bg-ink-1 p-5 font-mono text-[12px] leading-relaxed text-white/90">
{`curl -X POST https://api.tripbng.com/api/v1/search/flights \\
  -H "Authorization: Bearer $TRIPBNG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "tripType": "ONEWAY",
    "segments": [
      { "origin": "BOM", "destination": "DEL", "date": "2026-08-22" }
    ],
    "pax": { "adults": 1, "children": 0, "infants": 0 },
    "travelClass": "ECONOMY"
  }'`}
              </pre>
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Endpoints() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Reveal>
            <p className="eyebrow text-brand-600">Endpoints</p>
            <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
              64 endpoints. Same shape across the board.
            </h2>
          </Reveal>
          <Button asChild variant="secondary">
            <a href="/openapi.json" download>
              <Download className="h-4 w-4" /> Download OpenAPI
            </a>
          </Button>
        </div>
        <div className="mt-10 overflow-hidden rounded-xl border bg-surface-1">
          {ENDPOINTS.map((e, i) => (
            <div
              key={e.path}
              className={`group grid grid-cols-[80px_1fr_auto] items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-2 ${
                i !== ENDPOINTS.length - 1 ? 'border-b' : ''
              }`}
            >
              <span
                className={`grid place-items-center rounded-md px-2 py-1 font-mono text-[10px] font-bold ${
                  e.method === 'GET'
                    ? 'bg-success/15 text-success'
                    : e.method === 'POST'
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-warning/15 text-warning'
                }`}
              >
                {e.method}
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold text-ink-1">{e.path}</p>
                <p className="mt-0.5 text-xs text-ink-3">{e.desc}</p>
              </div>
              <Badge variant="brand" className="font-normal">
                {e.group}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Webhooks() {
  return (
    <section id="webhooks" className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Webhooks</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Push notifications you can audit.
          </h2>
          <p className="mt-3 max-w-2xl text-base text-ink-3">
            Every webhook is HMAC-signed with your secret, retried with exponential back-off for 24
            hours, and lands in a tamper-evident audit log.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            { event: 'booking.confirmed', desc: 'PNR + ticket numbers issued.' },
            { event: 'booking.failed', desc: 'Supplier rejected; wallet auto-refunded.' },
            { event: 'booking.cancelled', desc: 'Cancellation completed; refund posted.' },
            { event: 'wallet.credit', desc: 'Top-up captured; balance updated.' },
            { event: 'wallet.debit', desc: 'Booking debit posted (atomic with booking).' },
            { event: 'invoice.created', desc: 'GST invoice ready; URL + JSON included.' },
          ].map((w, i) => (
            <Reveal key={w.event} delay={i * 50}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-brand-600" strokeWidth={1.75} />
                  <p className="font-mono text-sm font-bold text-ink-1">{w.event}</p>
                </div>
                <p className="mt-2 text-sm text-ink-3">{w.desc}</p>
              </Card>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-8">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Lock className="h-4 w-4 text-brand-600" />
                <p className="font-mono text-sm text-ink-2">
                  Verify <code className="text-ink-1">X-TripBng-Signature</code> on every request
                  with HMAC-SHA256.
                </p>
              </div>
              <Button asChild variant="link" className="-mr-3">
                <a href="#">
                  Signature recipe <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function Sdks() {
  return (
    <section id="postman" className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">SDKs</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Skip the boilerplate. Ship.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SDKS.map((s, i) => (
            <Reveal key={s.lang} delay={i * 60}>
              <Card interactive className="h-full p-5">
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-ink-1 font-mono text-[10px] font-bold text-white">
                    {s.logo}
                  </span>
                  <Badge variant="brand" className="font-normal">
                    v{s.version}
                  </Badge>
                </div>
                <h3 className="mt-3 text-base font-bold text-ink-1">{s.lang}</h3>
                <pre className="mt-3 overflow-x-auto rounded-md border bg-surface-2 px-3 py-2 font-mono text-[11px] text-ink-2">
                  {s.install}
                </pre>
                <a
                  href="#"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  GitHub <ArrowUpRight className="h-3 w-3" />
                </a>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10">
          <Card className="grid items-center gap-4 p-6 md:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-4">
              <Search className="h-5 w-5 text-brand-600" />
              <div>
                <p className="text-base font-bold text-ink-1">Postman collection</p>
                <p className="text-sm text-ink-3">64 endpoints with environments + auth pre-wired.</p>
              </div>
            </div>
            <Button asChild>
              <a href="/tripbng.postman_collection.json" download>
                <Download className="h-4 w-4" /> Download
              </a>
            </Button>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}
