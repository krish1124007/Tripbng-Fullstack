'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordRequestSchema, type ChangePasswordRequest } from '@tripbng/shared';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  KeyValue,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { useApiMutation } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { ApiCallError } from '@/lib/api';
import { TwoFactorSetup } from './_two-factor-setup';

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your profile, security, and preferences."
      />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileTab() {
  const user = useAuthStore((s) => s.user)!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Read-only — contact support to update your name or email.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2">
          <KeyValue label="Full name" value={user.fullName} />
          <KeyValue label="Email" value={user.email} />
          <KeyValue label="User code" value={user.userCode} mono />
          <KeyValue label="Role" value={user.role} mono />
          {user.agencyId ? <KeyValue label="Agency" value={user.agencyId} mono /> : null}
          {user.distributorId ? <KeyValue label="Distributor" value={user.distributorId} mono /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityTab() {
  const user = useAuthStore((s) => s.user)!;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(ChangePasswordRequestSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const changePwd = useApiMutation<ChangePasswordRequest, { ok: true }>(
    '/api/v1/auth/change-password',
    'POST',
    {
      onSuccess: () => {
        toast.success('Password updated');
        reset();
      },
      onError: (err) => {
        toast.error(err instanceof ApiCallError ? err.message : 'Failed');
      },
    },
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Use 10+ characters with letters and at least one number.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((values) => changePwd.mutate(values))}
            className="grid max-w-md gap-4"
          >
            <FormField
              id="currentPassword"
              label="Current password"
              required
              error={errors.currentPassword?.message}
            >
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                {...register('currentPassword')}
              />
            </FormField>
            <FormField
              id="newPassword"
              label="New password"
              required
              error={errors.newPassword?.message}
            >
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                {...register('newPassword')}
              />
            </FormField>
            <div>
              <Button type="submit" disabled={isSubmitting || changePwd.isPending}>
                {isSubmitting || changePwd.isPending ? 'Saving…' : 'Update password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            {user.twoFactorEnabled
              ? '2FA is enabled on this account. Disabling it lowers security — keep it on.'
              : 'Add a second factor using an authenticator app (Google Authenticator, 1Password, Authy).'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSetup />
        </CardContent>
      </Card>
    </div>
  );
}

function PreferencesTab() {
  const user = useAuthStore((s) => s.user)!;
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [theme, setTheme] = useState<string>('system');
  const [emailNotif, setEmailNotif] = useState(true);
  const [smsNotif, setSmsNotif] = useState(true);

  const update = useApiMutation<
    { preferences: { theme: string; notifications: { email: boolean; sms: boolean } } },
    unknown
  >(`/api/v1/users/${user.id}`, 'PATCH', {
    onSuccess: () => {
      toast.success('Preferences saved');
      if (accessToken) setAuth({ ...user }, accessToken);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>How TripBng shows up for you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FormField label="Theme">
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-ink-2">Notifications</h3>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm text-ink-1">Email</span>
              <span className="block text-xs text-ink-3">Booking confirmations, top-up updates.</span>
            </span>
            <Switch checked={emailNotif} onCheckedChange={setEmailNotif} />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm text-ink-1">SMS</span>
              <span className="block text-xs text-ink-3">Critical alerts only (DLT-compliant).</span>
            </span>
            <Switch checked={smsNotif} onCheckedChange={setSmsNotif} />
          </label>
        </div>

        <div>
          <Button
            onClick={() =>
              update.mutate({
                preferences: {
                  theme,
                  notifications: { email: emailNotif, sms: smsNotif },
                },
              })
            }
            disabled={update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
