'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Network,
  PhoneCall,
  Receipt,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { PageHero } from '../_components/page-hero';
import { Reveal } from '../_components/reveal';
import { apiFetch, ApiCallError } from '@/lib/api';

const BENEFITS = [
  { icon: Sparkles, title: 'One platform, three fare types', body: 'Series, LCC, FSC — ranked together with your margin baked in.' },
  { icon: Wallet, title: 'Atomic wallet ledger', body: 'Top up via UPI / NEFT, debit on ticket, refund on cancel. To the rupee.' },
  { icon: Receipt, title: 'GST-clean invoicing', body: 'Invoices, e-tickets, CN/DN, GSTR-1 JSON — accountant-ready.' },
  { icon: ShieldCheck, title: '24h KYC', body: 'Submit PAN + GSTIN, run searches the same day, ticket once approved.' },
];

const STEPS = [
  { n: '01', title: 'Submit this form', desc: 'Tell us about your agency or distributor network.' },
  { n: '02', title: 'KYC call', desc: 'Our partnerships team calls within 4 business hours.' },
  { n: '03', title: 'Document upload', desc: 'PAN, GSTIN, IATA / TAFI, address proof — in-app.' },
  { n: '04', title: 'Go live', desc: 'Run your first search, top up wallet, ticket your first booking.' },
];

export default function ApplyPage() {
  return (
    <>
      <PageHero
        eyebrow="Apply to partner"
        title={
          <>
            Join 12,400+ agencies on the platform{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              built like a tool.
            </span>
          </>
        }
        subtitle={
          <>
            Agencies and distributors apply here — we don&apos;t do open sign-up. Submit the form
            below and our partnerships team reaches out within four business hours. Onboarding
            completes in under 24 hours once KYC docs are in.
          </>
        }
        actions={
          <>
            <Button asChild size="lg">
              <a href="#apply">
                Start application <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="tel:+912261964040">
                <PhoneCall className="h-4 w-4" /> +91 22 6196 4040
              </a>
            </Button>
          </>
        }
      />

      <Benefits />
      <ApplyForm />
      <Process />
    </>
  );
}

function Benefits() {
  return (
    <section className="bg-surface-1 py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b, i) => (
            <Reveal key={b.title} delay={i * 60}>
              <Card className="h-full p-5">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <b.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-3 text-base font-bold tracking-tight text-ink-1">{b.title}</h3>
                <p className="mt-1 text-sm text-ink-3">{b.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── The form ─────────────────────

interface FormState {
  type: 'AGENCY' | 'DISTRIBUTOR';
  companyName: string;
  fullName: string;
  email: string;
  mobile: string;
  city: string;
  state: string;
  gstin: string;
  sizeBand: string;
  message: string;
  /** Honeypot — kept hidden + ARIA-disabled; bots fill it, humans don't see it. */
  website: string;
}

const INITIAL: FormState = {
  type: 'AGENCY',
  companyName: '',
  fullName: '',
  email: '',
  mobile: '',
  city: '',
  state: '',
  gstin: '',
  sizeBand: '',
  message: '',
  website: '',
};

function ApplyForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.companyName || !form.fullName || !form.email || !form.mobile) {
      setError('Company, contact name, email and mobile are required.');
      setState('error');
      return;
    }
    setState('sending');
    setError(null);
    try {
      await apiFetch('/api/v1/inquiries', { method: 'POST', body: form });
      setState('sent');
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.message);
      } else {
        setError('Submission failed — please try again or call our partnerships line.');
      }
      setState('error');
    }
  }

  return (
    <section id="apply" className="bg-surface-0 py-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[1fr_1.3fr] lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">Application</p>
          <h2 className="mt-2 text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Tell us about your business.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-3">
            We&apos;ll triage your application against your region and book volume, then schedule a
            15-minute call to walk you through KYC and the dashboard.
          </p>
          <ul className="mt-7 space-y-3 text-sm text-ink-2">
            {[
              'Free to apply, free to onboard',
              'No upfront fee, no setup cost',
              'Counter-tested onboarding playbook',
              'Pre-launch wallet credit for the first 50 partners',
            ].map((b) => (
              <li key={b} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120}>
          <Card className="relative overflow-hidden p-6 lg:p-8">
            {/* Decorative gradient ribbon at the top of the card. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-accent-500 to-brand-500"
            />

            {state === 'sent' ? (
              <div className="grid place-items-center gap-3 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <h3 className="text-xl font-bold text-ink-1">Application received</h3>
                <p className="max-w-sm text-sm text-ink-3">
                  Our partnerships team will reach out within four business hours. Keep an eye on{' '}
                  <span className="font-semibold text-ink-1">{form.email}</span>.
                </p>
                <Button asChild variant="secondary">
                  <Link href="/">
                    Back to home <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="grid gap-4" noValidate>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold text-ink-2">I&apos;m applying as</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(['AGENCY', 'DISTRIBUTOR'] as const).map((t) => (
                      <label
                        key={t}
                        className={`group cursor-pointer rounded-lg border p-3 text-sm transition-all ${
                          form.type === t
                            ? 'border-brand-400 bg-brand-50/60 ring-2 ring-brand-200'
                            : 'hover:border-brand-300 hover:bg-surface-2'
                        }`}
                      >
                        <input
                          type="radio"
                          name="type"
                          value={t}
                          checked={form.type === t}
                          onChange={set('type')}
                          className="sr-only"
                        />
                        <div className="flex items-center gap-2">
                          {t === 'AGENCY' ? (
                            <Building2 className="h-4 w-4 text-brand-600" />
                          ) : (
                            <Network className="h-4 w-4 text-brand-600" />
                          )}
                          <span className="font-semibold text-ink-1">
                            {t === 'AGENCY' ? 'Travel agency' : 'Distributor / consolidator'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-3">
                          {t === 'AGENCY'
                            ? 'I book travel for end customers.'
                            : 'I run a network of sub-agents.'}
                        </p>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name" required>
                    <input className={INPUT_CLS} value={form.companyName} onChange={set('companyName')} placeholder="Sharma Travels" required />
                  </Field>
                  <Field label="Your name" required>
                    <input className={INPUT_CLS} value={form.fullName} onChange={set('fullName')} placeholder="Priya Sharma" required />
                  </Field>
                  <Field label="Work email" required>
                    <input className={INPUT_CLS} type="email" value={form.email} onChange={set('email')} placeholder="priya@agency.in" required />
                  </Field>
                  <Field label="Mobile (with country code)" required>
                    <input className={INPUT_CLS} type="tel" value={form.mobile} onChange={set('mobile')} placeholder="+91 98765 43210" required />
                  </Field>
                  <Field label="City">
                    <input className={INPUT_CLS} value={form.city} onChange={set('city')} placeholder="Lucknow" />
                  </Field>
                  <Field label="State">
                    <input className={INPUT_CLS} value={form.state} onChange={set('state')} placeholder="Uttar Pradesh" />
                  </Field>
                  <Field label="GSTIN (optional)">
                    <input className={INPUT_CLS} value={form.gstin} onChange={set('gstin')} placeholder="27ABCTI1234R1ZX" />
                  </Field>
                  <Field label="Team size">
                    <select className={INPUT_CLS} value={form.sizeBand} onChange={set('sizeBand')}>
                      <option value="">Select…</option>
                      <option value="1-3">Solo / 1–3 people</option>
                      <option value="4-10">4–10 people</option>
                      <option value="11-50">11–50 people</option>
                      <option value="50+">50+ people</option>
                    </select>
                  </Field>
                </div>

                <Field label="Anything we should know up front?">
                  <textarea
                    className={`${INPUT_CLS} resize-y`}
                    rows={4}
                    value={form.message}
                    onChange={set('message')}
                    placeholder="Volume estimate, current providers, areas you specialise in…"
                  />
                </Field>

                {/* Honeypot — visually + AT-hidden. */}
                <div className="hidden" aria-hidden>
                  <label>
                    Website (leave blank)
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={form.website}
                      onChange={set('website')}
                    />
                  </label>
                </div>

                {error ? (
                  <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="group relative overflow-hidden"
                  disabled={state === 'sending'}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                  />
                  <span className="relative inline-flex items-center gap-1.5">
                    {state === 'sending' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                      </>
                    ) : (
                      <>
                        Submit application <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </span>
                </Button>
                <p className="text-[11px] text-ink-3">
                  By submitting you agree to our{' '}
                  <Link href="/privacy" className="underline">
                    privacy policy
                  </Link>
                  . We&apos;ll never share your details with third parties.
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

function Process() {
  return (
    <section className="bg-surface-1 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <p className="eyebrow text-brand-600">What happens next</p>
          <h2 className="mt-2 max-w-3xl text-display-2 font-bold tracking-tight text-balance text-ink-1">
            Four steps. About 24 hours.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 60}>
              <Card interactive className="h-full p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-brand-600">{s.n}</span>
                  <Badge variant="brand" className="font-normal">
                    <Clock className="h-3 w-3" /> {i < 2 ? 'Same day' : 'Day 1'}
                  </Badge>
                </div>
                <h3 className="mt-3 text-base font-bold tracking-tight text-ink-1">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-3">{s.desc}</p>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10 grid items-center gap-4 sm:grid-cols-[1fr_auto]">
          <p className="text-sm text-ink-3">
            Prefer to talk first? Our partnerships team is on the line during business hours.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <a href="tel:+912261964040">
                <PhoneCall className="h-3.5 w-3.5" /> +91 22 6196 4040
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href="mailto:partner@tripbng.com">
                <Mail className="h-3.5 w-3.5" /> partner@tripbng.com
              </a>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
