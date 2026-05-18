'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CheckCircle2,
  Clock,
  HeartHandshake,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  PhoneCall,
  Send,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';

const CHANNELS = [
  {
    icon: HeartHandshake,
    title: 'Trade desk',
    desc: 'Hold-confirm, ticketing, refunds, urgent on-trip issues.',
    detail: '+91 22 6196 4040',
    href: 'tel:+912261964040',
    sla: '24×7 · 90s first response',
    badge: 'For partners',
  },
  {
    icon: TrendingUp,
    title: 'Sales',
    desc: 'New agency onboarding, distributor partnerships, override structures.',
    detail: 'sales@tripbng.com',
    href: 'mailto:sales@tripbng.com',
    sla: 'Mon–Sat · 4h response',
    badge: 'For new agencies',
  },
  {
    icon: MessageSquare,
    title: 'Help center',
    desc: 'How-to guides, KYC questions, wallet flows.',
    detail: 'help.tripbng.com',
    href: '/help',
    sla: 'Self-serve · in-app chat 24×7',
    badge: 'Self-serve',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance',
    desc: 'DPDP Act requests, vulnerability reports, regulatory notices.',
    detail: 'compliance@tripbng.com',
    href: 'mailto:compliance@tripbng.com',
    sla: 'Acknowledged within 48h',
    badge: 'Legal',
  },
];

const OFFICES = [
  {
    name: 'Mumbai · HQ',
    addr: 'WeWork BKC, Bandra Kurla Complex, Mumbai 400051',
    map: 'https://maps.google.com/?q=BKC+Mumbai',
  },
  {
    name: 'Bengaluru',
    addr: 'Cowrks Embassy, Outer Ring Road, Bengaluru 560103',
    map: 'https://maps.google.com/?q=Embassy+Tech+Village+Bengaluru',
  },
  {
    name: 'Delhi NCR',
    addr: 'Awfis Saket, District Centre, New Delhi 110017',
    map: 'https://maps.google.com/?q=Saket+District+Centre+Delhi',
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Get in touch"
        title={
          <>
            Real people,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              90 seconds to first response.
            </span>
          </>
        }
        subtitle={
          <>
            We answer the phone in Hindi, English, Marathi, and Tamil — round the clock for partner
            agencies, business hours for new sales conversations. Or fill the form and we&apos;ll
            route you to the right desk.
          </>
        }
      />

      <Channels />
      <ContactForm />
      <Offices />
    </>
  );
}

function Channels() {
  return (
    <section className="bg-surface-1 py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {CHANNELS.map((c, i) => (
            <Reveal key={c.title} delay={i * 60}>
              <Card interactive className="flex h-full flex-col p-6">
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
                <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                  {c.sla}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── Form ─────────────────────

function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [agency, setAgency] = useState('');
  const [topic, setTopic] = useState('Sales');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !message) return;
    setState('sending');
    // No backend endpoint for the marketing form yet — we open the user's
    // mail client pre-filled so the message still lands at the right inbox.
    // Replace with a real POST once /api/v1/leads ships.
    const inbox =
      topic === 'Sales'
        ? 'sales@tripbng.com'
        : topic === 'Trade desk'
          ? 'trade@tripbng.com'
          : topic === 'Compliance'
            ? 'compliance@tripbng.com'
            : 'hello@tripbng.com';
    const subject = `[${topic}] ${name} · ${agency || 'TripBng inquiry'}`;
    const body = `Name: ${name}\nEmail: ${email}\nAgency: ${agency}\n\n${message}`;
    window.location.href = `mailto:${inbox}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    setTimeout(() => setState('sent'), 350);
  }

  return (
    <section className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[1fr_1.2fr] lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Send a note</p>
          <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
            We route your message in two business hours.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-3">
            Tell us what you&apos;re trying to do. The right person will reply — no ticket-shuffling,
            no bots, no &ldquo;please describe your issue in detail&rdquo; loops.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm text-ink-2">
            {[
              'Encrypted in transit, stored only as long as needed',
              'DPDP Act 2023 compliant',
              'No tracking pixels, no analytics on this form',
            ].map((b) => (
              <li key={b} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120}>
          <Card className="p-6 lg:p-8">
            {state === 'sent' ? (
              <div className="grid place-items-center gap-3 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
                  <Send className="h-5 w-5" />
                </span>
                <h3 className="text-xl font-bold text-ink-1">Mail composed</h3>
                <p className="max-w-sm text-sm text-ink-3">
                  Your mail client should have opened with the right inbox + subject pre-filled.
                  Send when you&apos;re ready — we&apos;ll reply within two business hours.
                </p>
                <Button variant="secondary" onClick={() => setState('idle')}>
                  Send another
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your name" required>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={INPUT_CLS}
                      placeholder="Priya Sharma"
                    />
                  </Field>
                  <Field label="Email" required>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={INPUT_CLS}
                      placeholder="priya@agency.in"
                    />
                  </Field>
                </div>
                <Field label="Agency / company">
                  <input
                    value={agency}
                    onChange={(e) => setAgency(e.target.value)}
                    className={INPUT_CLS}
                    placeholder="Sharma Travels, Lucknow"
                  />
                </Field>
                <Field label="Topic">
                  <select
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option>Sales</option>
                    <option>Trade desk</option>
                    <option>Compliance</option>
                    <option>Partnerships</option>
                    <option>Press</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="Message" required>
                  <textarea
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className={`${INPUT_CLS} resize-y`}
                    placeholder="Tell us what you’re trying to do…"
                  />
                </Field>
                <Button type="submit" size="lg" disabled={state === 'sending'}>
                  {state === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Routing…
                    </>
                  ) : (
                    <>
                      Send message <Send className="h-4 w-4" />
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-ink-3">
                  By sending, you agree to our{' '}
                  <Link href="/privacy" className="underline">
                    privacy policy
                  </Link>
                  . We don&apos;t share contact data with third parties.
                </p>
              </form>
            )}
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

const INPUT_CLS =
  'w-full rounded-md border bg-surface-1 px-3 py-2.5 text-sm text-ink-1 placeholder:text-ink-4 transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">
        {label} {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}

// ───────────────────── Offices ─────────────────────

function Offices() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Where we are</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            HQ in Mumbai. Hubs in Bengaluru and Delhi.
          </h2>
          <p className="mt-3 max-w-2xl text-base text-ink-3">
            Drop by — please call ahead. Registered office for legal correspondence is the Mumbai
            address.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {OFFICES.map((o, i) => (
            <Reveal key={o.name} delay={i * 60}>
              <Card className="h-full p-6">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Building2 className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-1">{o.name}</h3>
                <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
                  {o.addr}
                </p>
                <Button asChild variant="link" className="mt-3 -ml-3">
                  <a href={o.map} target="_blank" rel="noreferrer">
                    Open in Maps
                  </a>
                </Button>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10">
          <Card className="grid gap-4 p-6 sm:grid-cols-3 sm:items-center">
            <div className="sm:col-span-2">
              <p className="text-sm font-semibold text-ink-1">Tripbng India Private Limited</p>
              <p className="mt-1 text-xs text-ink-3 font-mono">CIN: U63040MH2022PTC123456 · GSTIN: 27ABCTI1234R1ZX</p>
            </div>
            <div className="flex justify-start gap-3 sm:justify-end">
              <Button asChild variant="secondary" size="sm">
                <a href="mailto:hello@tripbng.com">
                  <Mail className="h-3.5 w-3.5" /> hello@tripbng.com
                </a>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href="tel:+912261964040">
                  <PhoneCall className="h-3.5 w-3.5" /> +91 22 6196 4040
                </a>
              </Button>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}
