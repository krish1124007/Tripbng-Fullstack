'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { apiFetch, ApiCallError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState('sending');
    setError(null);
    try {
      await apiFetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      // The endpoint always returns success — we don't leak whether an
      // email exists on the platform. The "sent" state is correct
      // regardless; if the email isn't registered, no mail is delivered.
      setState('sent');
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again in a moment.');
      }
      setState('error');
    }
  }

  return (
    <div data-theme="light" className="grid min-h-screen bg-surface-1 lg:grid-cols-[1fr_1.1fr]">
      {/* ── Left: brand + reassurance — much simpler than the login panel
            since the user is mid-recovery and we want clarity, not flourish. */}
      <aside className="bg-brand-aurora relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-1/4 h-[24rem] w-[24rem] rounded-full bg-brand-400/30 blur-3xl mix-blend-screen animate-float-orb"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 bottom-0 h-[22rem] w-[22rem] rounded-full bg-accent-400/25 blur-3xl mix-blend-screen animate-float-orb-slow"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/25" />

        <div className="relative z-10">
          <Logo variant="full" className="h-9" onDark />
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="text-display-2 font-bold tracking-tight text-balance text-white">
            Recover your{' '}
            <span className="animate-text-shine bg-gradient-to-r from-accent-300 via-amber-200 to-accent-300 bg-clip-text text-transparent">
              dashboard access.
            </span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-white/80">
            We&apos;ll send a one-time reset link to your registered email. The link is good for 30
            minutes and works exactly once.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {[
              'Link valid for 30 minutes, single-use',
              'Sent to your registered email only',
              'No password is ever revealed over email',
            ].map((b) => (
              <li key={b} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" strokeWidth={2} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          DPDP Act 2023 compliant · audit-logged
        </div>
      </aside>

      {/* ── Right: light form panel ── */}
      <main className="relative flex flex-col overflow-hidden bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-100/40 blur-3xl"
        />
        <div className="relative flex h-16 items-center px-6 lg:hidden">
          <Logo variant="full" className="h-7" />
        </div>

        <div className="relative flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[420px] animate-fade-in-up">
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-3 transition-colors hover:text-brand-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>

            {state === 'sent' ? (
              <div className="mt-6 animate-fade-in-up">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
                  <CheckCircle2 className="h-6 w-6" strokeWidth={2} />
                </span>
                <h2 className="mt-5 text-h1 font-bold tracking-tight text-ink-1">Check your inbox</h2>
                <p className="mt-2 text-sm text-ink-3">
                  If <span className="font-semibold text-ink-1">{email}</span> is registered with us,
                  a reset link will arrive in the next minute or two.
                </p>
                <ul className="mt-6 space-y-2 text-sm text-ink-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                    Look in spam if you don&apos;t see it.
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                    The link expires in 30 minutes.
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                    Still stuck? Email{' '}
                    <a href="mailto:trade@tripbng.com" className="font-semibold text-brand-700 hover:underline">
                      trade@tripbng.com
                    </a>
                    .
                  </li>
                </ul>
                <Button asChild className="mt-8 w-full" size="lg" variant="secondary">
                  <Link href="/login">
                    Back to sign in <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <>
                <p className="mt-6 font-mono text-[11px] font-bold uppercase tracking-wider text-brand-600">
                  Password reset
                </p>
                <h2 className="mt-2 text-h1 font-bold leading-tight tracking-tight text-ink-1">
                  Forgot your{' '}
                  <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                    password?
                  </span>
                </h2>
                <p className="mt-2 text-sm text-ink-3">
                  Enter the email tied to your TripBng account. We&apos;ll send you a single-use
                  reset link.
                </p>

                <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-semibold">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@agency.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      leading={<Mail className="h-4 w-4" strokeWidth={1.75} />}
                    />
                  </div>

                  {error ? (
                    <div
                      role="alert"
                      className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                    >
                      {error}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    className="group relative w-full overflow-hidden"
                    disabled={state === 'sending'}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                    />
                    <span className="relative inline-flex items-center gap-1.5">
                      {state === 'sending' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Sending link…
                        </>
                      ) : (
                        <>
                          Send reset link <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </span>
                  </Button>
                </form>

                <p className="mt-6 text-xs text-ink-3">
                  Remembered it?{' '}
                  <Link href="/login" className="font-semibold text-brand-700 hover:underline">
                    Sign in instead
                  </Link>
                  .
                </p>
              </>
            )}
          </div>
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t bg-white px-6 py-3 text-xs text-ink-4">
          <span className="font-mono">v1.0 · {new Date().getFullYear()}</span>
          <span>
            Need help?{' '}
            <a href="mailto:trade@tripbng.com" className="font-semibold text-brand-700 hover:underline">
              trade@tripbng.com
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
