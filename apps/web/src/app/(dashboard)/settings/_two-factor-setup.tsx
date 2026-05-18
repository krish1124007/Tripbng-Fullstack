'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { TwoFactorSetupResponse } from '@tripbng/shared';
import { Button, FormField, Input } from '@/components/ui';
import { useApiMutation } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';

export function TwoFactorSetup() {
  const user = useAuthStore((s) => s.user)!;
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [code, setCode] = useState('');

  const setup = useApiMutation<Record<string, never>, TwoFactorSetupResponse>(
    '/api/v1/auth/2fa/setup',
    'POST',
    {
      onSuccess: (data) => setSetupData(data),
      onError: (err) => toast.error(err.message),
    },
  );

  const verify = useApiMutation<{ totp: string }, { ok: true }>(
    '/api/v1/auth/2fa/verify',
    'POST',
    {
      onSuccess: () => {
        toast.success('2FA enabled');
        setSetupData(null);
        setCode('');
        if (accessToken) setAuth({ ...user, twoFactorEnabled: true }, accessToken);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const disable = useApiMutation<Record<string, never>, { ok: true }>(
    '/api/v1/auth/2fa/disable',
    'POST',
    {
      onSuccess: () => {
        toast.success('2FA disabled');
        if (accessToken) setAuth({ ...user, twoFactorEnabled: false }, accessToken);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  if (user.twoFactorEnabled) {
    return (
      <Button variant="danger" onClick={() => disable.mutate({})} disabled={disable.isPending}>
        {disable.isPending ? 'Disabling…' : 'Disable 2FA'}
      </Button>
    );
  }

  if (!setupData) {
    return (
      <Button onClick={() => setup.mutate({})} disabled={setup.isPending}>
        {setup.isPending ? 'Generating…' : 'Begin 2FA setup'}
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        Scan this QR with your authenticator app, then enter the 6-digit code below to activate.
      </p>
      <div className="flex flex-wrap items-center gap-6">
        <img
          src={setupData.qrDataUrl}
          alt="2FA QR code"
          className="h-40 w-40 rounded-md border bg-white p-2"
        />
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-ink-3">Manual key</p>
          <code className="block rounded bg-surface-2 px-2 py-1 font-mono text-xs">
            {setupData.secret}
          </code>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="totp" label="6-digit code">
          <Input
            id="totp"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-40"
          />
        </FormField>
        <Button
          onClick={() => verify.mutate({ totp: code })}
          disabled={code.length !== 6 || verify.isPending}
        >
          {verify.isPending ? 'Verifying…' : 'Confirm & enable'}
        </Button>
        <Button variant="ghost" onClick={() => setSetupData(null)} disabled={verify.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
