'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Receipt,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { LoginRequestSchema, type LoginRequest, type LoginResponse } from '@tripbng/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { apiFetch, ApiCallError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const VALUE_PROPS = [
  {
    icon: Sparkles,
    title: 'Search → Hold → Ticket in one flow',
    desc: 'Series fares, GDS rates, and your contracted overrides — priced live, no surprises.',
  },
  {
    icon: Wallet,
    title: 'Every paisa traceable',
    desc: 'Immutable ledger, real-time wallet, instant statements. Match your books to the rupee.',
  },
  {
    icon: Receipt,
    title: 'GST-clean invoicing',
    desc: 'Auto-generated invoices, e-tickets, and CN/DN — ready for your accountant on day one.',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [needsEnrolment, setNeedsEnrolment] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setFocus,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: searchParams.get('email') ?? '', password: '' },
  });
  const emailValue = watch('email');

  useEffect(() => {
    setFocus(searchParams.get('email') ? 'password' : 'email');
  }, [setFocus, searchParams]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setNeedsEnrolment(false);
    try {
      const res = await apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: values,
      });
      setAuth(res.user as Parameters<typeof setAuth>[0], res.accessToken);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === 'TOTP_REQUIRED') {
          // The API sets `details.enrolUrl` when the account hasn't enrolled
          // 2FA yet — the user needs to set up an authenticator first, not
          // type in a code they don't have. We surface a "Set up 2FA" CTA
          // that deep-links to /setup-2fa with the email pre-filled.
          const enrolUrl = (err.details as { enrolUrl?: string } | undefined)?.enrolUrl;
          if (enrolUrl) {
            setNeedsEnrolment(true);
            setError('Two-factor authentication is required for this account. Set it up to continue.');
            return;
          }
          setNeedsTotp(true);
          setError('Enter your 6-digit authenticator code to continue.');
          return;
        }
        setError(err.message);
        return;
      }
      setError('Something went wrong, please try again.');
    }
  });

  return (
    // Force light theme — auth flow is brand-first; we don't want a user's
    // OS dark preference flipping this surface and clashing with the
    // marketing chrome they came from.
    <div data-theme="light" className="grid min-h-screen bg-surface-1 lg:grid-cols-[1.1fr_1fr]">
      {/* ─────────── Brand panel (left) — kept rich + colourful so the form
                     side can be a clean white panel without losing the brand. */}
      <aside className="bg-brand-aurora relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        {/* Floating glow orbs — same motion vocabulary as the landing hero
            so the login feels like a continuation of the marketing site. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-[26rem] w-[26rem] rounded-full bg-brand-400/30 blur-3xl mix-blend-screen animate-float-orb"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-1/3 h-[22rem] w-[22rem] rounded-full bg-accent-400/25 blur-3xl mix-blend-screen animate-float-orb-slow"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/25" />

        <div className="relative z-10 flex items-center gap-3">
          <Logo variant="full" className="h-9" onDark />
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-display-2 font-bold tracking-tight text-balance text-white xl:text-display-1">
            B2B travel,
            <br />
            <span className="animate-text-shine bg-gradient-to-r from-accent-300 via-amber-200 to-accent-300 bg-clip-text text-transparent">
              finally built like a tool agents
            </span>{' '}
            actually want to use.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-white/80">
            Series fares, distributor cockpits, and a transparent ledger. One platform, every paisa
            traceable.
          </p>

          <ul className="mt-10 space-y-5">
            {VALUE_PROPS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 text-accent-300 ring-1 ring-white/15 backdrop-blur">
                  <p.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="font-semibold text-white">{p.title}</p>
                  <p className="mt-1 text-sm text-white/70">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          DPDP Act 2023 compliant · 2FA enforced for admins
        </div>
      </aside>

      {/* ─────────── Form panel (right) — pure white, with subtle gradient
                     halo behind the form card so it doesn't read as a wall. */}
      <main className="relative flex flex-col overflow-hidden bg-white">
        {/* Decorative gradient halo — sits behind the form, low-intensity. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-100/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-[24rem] w-[24rem] rounded-full bg-accent-100/30 blur-3xl"
        />

        {/* Mobile-only header (brand panel hidden on mobile) */}
        <div className="relative flex h-16 items-center justify-between px-6 lg:hidden">
          <Logo variant="full" className="h-7" />
          <Link
            href="/register"
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            Apply to partner
          </Link>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[420px] space-y-7 animate-fade-in-up">
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-brand-600">
                Welcome back
              </p>
              <h2 className="mt-2 text-h1 font-bold leading-tight tracking-tight text-ink-1">
                Sign in to{' '}
                <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                  your dashboard
                </span>
              </h2>
              <p className="mt-2 text-sm text-ink-3">
                Use the credentials your distributor or onboarding manager shared.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@agency.com"
                  invalid={!!errors.email}
                  leading={<Mail className="h-4 w-4" strokeWidth={1.75} />}
                  {...register('email')}
                />
                {errors.email ? (
                  <p className="text-xs text-danger" role="alert">
                    {errors.email.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-semibold">
                    Password
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  invalid={!!errors.password}
                  leading={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="text-ink-3 transition-colors hover:text-ink-1"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                      ) : (
                        <Eye className="h-4 w-4" strokeWidth={1.75} />
                      )}
                    </button>
                  }
                  {...register('password')}
                />
                {errors.password ? (
                  <p className="text-xs text-danger" role="alert">
                    {errors.password.message}
                  </p>
                ) : null}
              </div>

              {needsEnrolment ? (
                <div className="space-y-3 animate-slide-down rounded-md border border-brand-200 bg-brand-50 p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-brand-700 ring-1 ring-brand-200">
                      <ShieldCheck className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-1">Set up two-factor authentication</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                        This account requires 2FA but hasn't been enrolled yet. Scan a QR code
                        with your authenticator app to finish setup.
                      </p>
                    </div>
                  </div>
                  <Button asChild size="sm" className="w-full">
                    <Link href={`/setup-2fa?email=${encodeURIComponent(emailValue ?? '')}`}>
                      Set up now <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : null}

              {needsTotp ? (
                <div className="space-y-2 animate-slide-down rounded-md border border-brand-200 bg-brand-50 p-4">
                  <Label htmlFor="totp" className="text-sm font-semibold">
                    Authenticator code
                  </Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123 456"
                    autoComplete="one-time-code"
                    autoFocus
                    leading={<ShieldCheck className="h-4 w-4 text-brand-600" strokeWidth={1.75} />}
                    {...register('totp')}
                  />
                  <p className="text-xs text-ink-3">
                    Open your authenticator app and enter the 6-digit code for TripBng.
                  </p>
                </div>
              ) : null}

              {error && !needsTotp && !needsEnrolment ? (
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
                loading={isSubmitting}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                />
                <span className="relative inline-flex items-center gap-1.5">
                  {!isSubmitting ? (
                    <>
                      Sign in <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    'Signing in…'
                  )}
                </span>
              </Button>

              <p className="text-center text-xs text-ink-3">
                By signing in you agree to our{' '}
                <Link href="/terms" className="font-medium text-brand-600 hover:underline">
                  Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="font-medium text-brand-600 hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </form>

            {/* ── Apply CTA — for prospects who don't have an account yet ── */}
            <div className="relative rounded-xl border bg-gradient-to-br from-brand-50 via-white to-accent-50/40 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm">
                  <Sparkles className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-1">New to TripBng?</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                    Agencies + distributors can sign up online. We onboard in under 24 hours.
                  </p>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/register">
                    Sign up <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* ── App store coming soon ── */}
            <AppStoreBanner />
          </div>
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t bg-white px-6 py-3 text-xs text-ink-4">
          <span className="font-mono">v1.0 · {new Date().getFullYear()}</span>
          <span>
            Need access?{' '}
            <Link href="/register" className="font-semibold text-brand-700 hover:underline">
              Apply to partner
            </Link>
          </span>
        </footer>
      </main>
    </div>
  );
}

// Shared coming-soon badges — also used on the landing page. Kept inline
// because we don't have a real store URL yet; once we do, swap the
// disabled state for actual links + remove the "Coming soon" pill.

function AppStoreBanner() {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-white">
          <Smartphone className="h-4 w-4" strokeWidth={2} />
        </span>
        <p className="text-sm font-bold text-ink-1">Mobile app — coming soon</p>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent-100/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-700">
          <CheckCircle2 className="h-2.5 w-2.5" /> Beta
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">
        Search, hold, ticket, top-up — full counter on a phone. Drops to App Store and Play Store
        in October.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <StoreBadge platform="apple" />
        <StoreBadge platform="google" />
      </div>
    </div>
  );
}

function StoreBadge({ platform }: { platform: 'apple' | 'google' }) {
  const label = platform === 'apple' ? 'App Store' : 'Google Play';
  const tagline = platform === 'apple' ? 'Download on the' : 'Get it on';
  return (
    <span
      aria-disabled
      className="group relative inline-flex h-12 items-center gap-2 overflow-hidden rounded-lg bg-ink-1 px-3 text-white opacity-90"
      title="Coming soon"
    >
      <span aria-hidden className="text-2xl leading-none">
        {platform === 'apple' ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M16.365 1.43c0 1.14-.46 2.18-1.36 2.96-.91.78-2.07 1.18-3.06 1.1-.12-1.18.42-2.4 1.25-3.17.86-.81 2.07-1.31 3.17-1.34v.45zm3.61 7.6c-.02.4-.78 2.41-2.34 4.49-1.34 1.79-2.74 3.58-4.94 3.62-2.16.04-2.86-1.27-5.34-1.27-2.49 0-3.27 1.23-5.31 1.31-2.13.08-3.75-1.94-5.1-3.73C-5.42 9.39-3.36 4.66.05 4.6c2.06-.04 4 1.39 5.26 1.39 1.26 0 3.59-1.71 6.06-1.46.83.04 3.18.34 4.69 2.55l-2.06 1.2c-1.62.96-3.84 3.05-3.84 6.74 0 4.32 3.77 5.84 3.86 5.87-.03.07-.59 2.04-1.94 4.13z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M3.609 1.814 13.792 12 3.609 22.186a.996.996 0 0 1-.609-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893 2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.198 2.733 1.583a1 1 0 0 1 0 1.726l-2.732 1.582-2.585-2.585 2.584-2.586zM5.864 2.658 16.802 8.99l-2.302 2.303-8.636-8.635z" />
          </svg>
        )}
      </span>
      <span className="leading-tight">
        <span className="block text-[8px] uppercase tracking-wider text-white/60">{tagline}</span>
        <span className="block text-sm font-semibold">{label}</span>
      </span>
      <span
        aria-hidden
        className="absolute right-1.5 top-1.5 rounded-full bg-accent-500 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-white shadow"
      >
        Soon
      </span>
    </span>
  );
}
