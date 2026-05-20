'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  TwoFactorBootstrapSetupRequestSchema,
  type TwoFactorBootstrapSetupRequest,
  type TwoFactorSetupResponse,
} from '@tripbng/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { apiFetch, ApiCallError } from '@/lib/api';

type Step = 'credentials' | 'scan' | 'done';

// Next 14 prerenders pages by default. Anything that calls useSearchParams must
// sit inside a <Suspense> boundary or the static build bails out. We wrap the
// real page component below.
export default function SetupTwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <SetupTwoFactorPageInner />
    </Suspense>
  );
}

function SetupTwoFactorPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const prefilledEmail = params.get('email') ?? '';

  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [enrolment, setEnrolment] = useState<TwoFactorSetupResponse | null>(null);
  const [creds, setCreds] = useState<TwoFactorBootstrapSetupRequest | null>(null);
  const [totp, setTotp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorBootstrapSetupRequest>({
    resolver: zodResolver(TwoFactorBootstrapSetupRequestSchema),
    defaultValues: { email: prefilledEmail, password: '' },
  });

  useEffect(() => {
    setFocus(prefilledEmail ? 'password' : 'email');
  }, [setFocus, prefilledEmail]);

  const onCredentialsSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await apiFetch<TwoFactorSetupResponse>(
        '/api/v1/auth/2fa/bootstrap-setup',
        { method: 'POST', body: values },
      );
      setEnrolment(res);
      setCreds(values);
      setStep('scan');
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === 'TOTP_ALREADY_ENABLED') {
          setError(
            'This account already has 2FA enrolled. Sign in with your existing authenticator code.',
          );
          return;
        }
        setError(err.message);
        return;
      }
      setError('Something went wrong, please try again.');
    }
  });

  async function onVerify() {
    if (!creds || totp.length !== 6) return;
    setError(null);
    setVerifying(true);
    try {
      await apiFetch<{ ok: true }>('/api/v1/auth/2fa/bootstrap-verify', {
        method: 'POST',
        body: { ...creds, totp },
      });
      setStep('done');
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.message);
      } else {
        setError('Something went wrong, please try again.');
      }
    } finally {
      setVerifying(false);
    }
  }

  async function copySecret() {
    if (!enrolment) return;
    try {
      await navigator.clipboard.writeText(enrolment.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div data-theme="light" className="grid min-h-screen bg-surface-1 lg:grid-cols-[1.1fr_1fr]">
      <aside className="bg-brand-aurora relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
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
            Lock your account with{' '}
            <span className="animate-text-shine bg-gradient-to-r from-accent-300 via-amber-200 to-accent-300 bg-clip-text text-transparent">
              two-factor authentication
            </span>
            .
          </h1>
          <p className="mt-6 text-base leading-relaxed text-white/80">
            Admin accounts must enrol an authenticator app before signing in. Takes 60 seconds and
            you only do it once per device.
          </p>

          <ol className="mt-10 space-y-5 text-sm text-white/80">
            <li className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-xs font-bold text-white ring-1 ring-white/15">
                1
              </span>
              <span>Sign in with your email + password — we'll show a QR code.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-xs font-bold text-white ring-1 ring-white/15">
                2
              </span>
              <span>Scan it with Google Authenticator, Authy, or 1Password.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-xs font-bold text-white ring-1 ring-white/15">
                3
              </span>
              <span>Enter the 6-digit code shown in your app to finish setup.</span>
            </li>
          </ol>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          DPDP Act 2023 compliant · 2FA enforced for admins
        </div>
      </aside>

      <main className="relative flex flex-col overflow-hidden bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-100/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-[24rem] w-[24rem] rounded-full bg-accent-100/30 blur-3xl"
        />

        <div className="relative flex h-16 items-center justify-between px-6 lg:hidden">
          <Logo variant="full" className="h-7" />
          <Link href="/login" className="text-xs font-semibold text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[460px] space-y-7 animate-fade-in-up">
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-brand-600">
                Two-factor setup
              </p>
              <h2 className="mt-2 text-h1 font-bold leading-tight tracking-tight text-ink-1">
                Enrol your{' '}
                <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                  authenticator
                </span>
              </h2>
              <p className="mt-2 text-sm text-ink-3">
                One-time setup. After this you'll sign in with email, password and a 6-digit code.
              </p>
            </div>

            {step === 'credentials' ? (
              <form onSubmit={onCredentialsSubmit} className="space-y-5" noValidate>
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
                  <Label htmlFor="password" className="text-sm font-semibold">
                    Password
                  </Label>
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
                  loading={isSubmitting}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                  />
                  <span className="relative inline-flex items-center gap-1.5">
                    {!isSubmitting ? (
                      <>
                        Continue <ArrowRight className="h-4 w-4" />
                      </>
                    ) : (
                      'Verifying…'
                    )}
                  </span>
                </Button>

                <p className="text-center text-xs text-ink-3">
                  Already enrolled?{' '}
                  <Link href="/login" className="font-semibold text-brand-700 hover:underline">
                    Sign in instead
                  </Link>
                </p>
              </form>
            ) : null}

            {step === 'scan' && enrolment ? (
              <div className="space-y-5">
                <div className="rounded-xl border bg-surface-1 p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                      <Smartphone className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-1">Scan with your authenticator</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                        Open Google Authenticator, Authy, or 1Password and scan the QR below.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid place-items-center rounded-lg bg-white p-4 ring-1 ring-strong">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={enrolment.qrDataUrl}
                      alt="2FA enrolment QR code"
                      className="h-48 w-48"
                      width={192}
                      height={192}
                    />
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                      Or enter this secret manually
                    </Label>
                    <button
                      type="button"
                      onClick={copySecret}
                      className="group flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 font-mono text-sm text-ink-1 transition-colors hover:bg-surface-2"
                    >
                      <span className="truncate">{enrolment.secret}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-600">
                        {copied ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> Copy
                          </>
                        )}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="totp" className="text-sm font-semibold">
                    Enter the 6-digit code from your app
                  </Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123 456"
                    autoComplete="one-time-code"
                    autoFocus
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    leading={<ShieldCheck className="h-4 w-4 text-brand-600" strokeWidth={1.75} />}
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
                  type="button"
                  size="lg"
                  className="group relative w-full overflow-hidden"
                  loading={verifying}
                  disabled={totp.length !== 6}
                  onClick={onVerify}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                  />
                  <span className="relative inline-flex items-center gap-1.5">
                    {!verifying ? (
                      <>
                        Activate 2FA <ArrowRight className="h-4 w-4" />
                      </>
                    ) : (
                      'Activating…'
                    )}
                  </span>
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials');
                    setEnrolment(null);
                    setTotp('');
                    setError(null);
                  }}
                  className="block w-full text-center text-xs font-medium text-ink-3 hover:text-ink-1 hover:underline"
                >
                  Use a different account
                </button>
              </div>
            ) : null}

            {step === 'done' ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-success/30 bg-success-soft p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-success ring-1 ring-success/30">
                      <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-1">2FA is now active</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                        From now on you'll need a 6-digit code from your authenticator app every
                        time you sign in.
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  size="lg"
                  className="group relative w-full overflow-hidden"
                  onClick={() => router.push(`/login?email=${encodeURIComponent(creds?.email ?? '')}`)}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                  />
                  <span className="relative inline-flex items-center gap-1.5">
                    Go to sign in <ArrowRight className="h-4 w-4" />
                  </span>
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t bg-white px-6 py-3 text-xs text-ink-4">
          <span className="font-mono">v1.0 · {new Date().getFullYear()}</span>
          <span>
            Trouble signing in?{' '}
            <Link href="/login" className="font-semibold text-brand-700 hover:underline">
              Back to login
            </Link>
          </span>
        </footer>
      </main>
    </div>
  );
}
