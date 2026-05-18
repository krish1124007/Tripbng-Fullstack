'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { apiFetch, ApiCallError } from '@/lib/api';

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-surface-1">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      }
    >
      <ResetPasswordView />
    </Suspense>
  );
}

function ResetPasswordView() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This reset link is missing its token. Please request a new one.');
      setState('error');
    }
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      setState('error');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      setState('error');
      return;
    }
    setState('submitting');
    setError(null);
    try {
      await apiFetch('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      setState('done');
      // Redirect after a short pause so the user reads the success screen.
      setTimeout(() => router.replace('/login'), 2200);
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.message);
      } else {
        setError('Reset failed. Request a new link and try again.');
      }
      setState('error');
    }
  }

  return (
    <div data-theme="light" className="grid min-h-screen bg-surface-1 lg:grid-cols-[1fr_1.1fr]">
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
            One last step.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-white/80">
            Pick a strong new password. We hash with bcrypt + a per-user salt; the new password
            never appears in any log, ever.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          Single-use token · 30-minute window · audit-logged
        </div>
      </aside>

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

            {state === 'done' ? (
              <div className="mt-6 animate-fade-in-up">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
                  <CheckCircle2 className="h-6 w-6" strokeWidth={2} />
                </span>
                <h2 className="mt-5 text-h1 font-bold tracking-tight text-ink-1">
                  Password updated
                </h2>
                <p className="mt-2 text-sm text-ink-3">
                  Sending you to sign in…
                </p>
              </div>
            ) : (
              <>
                <p className="mt-6 font-mono text-[11px] font-bold uppercase tracking-wider text-brand-600">
                  Choose a new password
                </p>
                <h2 className="mt-2 text-h1 font-bold leading-tight tracking-tight text-ink-1">
                  Set a{' '}
                  <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                    fresh password.
                  </span>
                </h2>
                <p className="mt-2 text-sm text-ink-3">
                  At least 8 characters. Mix letters, numbers, and one symbol if you can.
                </p>

                <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-semibold">
                      New password
                    </Label>
                    <Input
                      id="password"
                      type={show ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      leading={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShow((v) => !v)}
                          aria-label={show ? 'Hide password' : 'Show password'}
                          className="text-ink-3 transition-colors hover:text-ink-1"
                        >
                          {show ? (
                            <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                          ) : (
                            <Eye className="h-4 w-4" strokeWidth={1.75} />
                          )}
                        </button>
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm" className="text-sm font-semibold">
                      Confirm new password
                    </Label>
                    <Input
                      id="confirm"
                      type={show ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      leading={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
                    />
                  </div>

                  {error ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    className="group relative w-full overflow-hidden"
                    disabled={state === 'submitting' || !token}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
                    />
                    <span className="relative inline-flex items-center gap-1.5">
                      {state === 'submitting' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Updating…
                        </>
                      ) : (
                        <>
                          Update password <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </span>
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t bg-white px-6 py-3 text-xs text-ink-4">
          <span className="font-mono">v1.0 · {new Date().getFullYear()}</span>
          <Link href="/forgot-password" className="font-semibold text-brand-700 hover:underline">
            Request a new link
          </Link>
        </footer>
      </main>
    </div>
  );
}
