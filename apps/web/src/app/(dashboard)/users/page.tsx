'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, PauseCircle, PlayCircle, KeyRound, UserCog, UserPlus, Eye } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicUser } from '@tripbng/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  PageHeader,
  Pagination,
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { CreateUserDrawer } from './_create-user-drawer';
import { EditUserDrawer } from './_edit-user-drawer';

export default function UsersPage() {
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicUser | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<PublicUser | null>(null);
  const [resetTarget, setResetTarget] = useState<PublicUser | null>(null);

  const list = useApiPaginatedQuery<PublicUser>(
    ['users', { page, q }],
    '/api/v1/users',
    { query: { page, limit: 20, q: q || undefined } },
  );

  const invalidate = useInvalidateOnSuccess([['users']]);

  const suspend = useApiMutation<{ id: string }, PublicUser>(
    (i) => `/api/v1/users/${i.id}/suspend`,
    'POST',
    {
      onSuccess: () => {
        toast.success('User suspended');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const activate = useApiMutation<{ id: string }, PublicUser>(
    (i) => `/api/v1/users/${i.id}/activate`,
    'POST',
    {
      onSuccess: () => {
        toast.success('User activated');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const resetPwd = useApiMutation<{ id: string }, { ok: true; tempPassword?: string }>(
    (i) => `/api/v1/users/${i.id}/reset-password`,
    'POST',
    {
      onSuccess: (data) => {
        if (data.tempPassword) {
          toast.success('Temporary password generated', {
            description: data.tempPassword,
            duration: 30_000,
          });
        } else {
          toast.success('Password reset');
        }
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const impersonate = useApiMutation<
    { userId: string; reason: string },
    { accessToken: string; target: { id: string; email: string; fullName: string; role: string; userCode: string } }
  >('/api/v1/auth/impersonate', 'POST', {
    onSuccess: (data) => {
      toast.success(`Now acting as ${data.target.fullName}`);
      setAuth(
        {
          id: data.target.id,
          userCode: data.target.userCode,
          email: data.target.email,
          fullName: data.target.fullName,
          role: data.target.role as PublicUser['role'],
          agencyId: null,
          distributorId: null,
          twoFactorEnabled: false,
          permissions: [],
        },
        data.accessToken,
      );
      router.push('/dashboard');
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = useMemo<ColumnDef<PublicUser, unknown>[]>(
    () => [
      {
        header: 'User',
        accessorKey: 'fullName',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.fullName}</span>
            <span className="text-xs text-ink-3">{row.original.email}</span>
          </div>
        ),
      },
      {
        header: 'Code',
        accessorKey: 'userCode',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-ink-2">{getValue() as string}</span>
        ),
      },
      {
        header: 'Role',
        accessorKey: 'role',
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
      },
      {
        header: 'Last login',
        accessorKey: 'lastLoginAt',
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return <span className="text-xs text-ink-3">{v ? new Date(v).toLocaleString() : '—'}</span>;
        },
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => {
          const u = row.original;
          const isMe = me?.id === u.id;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Row actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setEditTarget(u)}>
                    <UserCog className="h-4 w-4" /> Edit details
                  </DropdownMenuItem>
                  {u.status === 'ACTIVE' ? (
                    <DropdownMenuItem destructive onClick={() => setSuspendTarget(u)} disabled={isMe}>
                      <PauseCircle className="h-4 w-4" /> Suspend
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => activate.mutate({ id: u.id })} disabled={isMe}>
                      <PlayCircle className="h-4 w-4" /> Activate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setResetTarget(u)} disabled={isMe}>
                    <KeyRound className="h-4 w-4" /> Reset password
                  </DropdownMenuItem>
                  {me?.role === 'SUPER_ADMIN' && !isMe ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          impersonate.mutate({ userId: u.id, reason: 'admin assist' })
                        }
                      >
                        <Eye className="h-4 w-4" /> Sign in as user
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [me?.id, me?.role, activate, impersonate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description="Create staff accounts, manage roles, and audit access."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" /> New user
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <Input
          placeholder="Search by name, email, or code"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="w-full sm:max-w-sm"
        />
      </div>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No users yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <CreateUserDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <EditUserDrawer
        target={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />

      <ConfirmDialog
        open={!!suspendTarget}
        onOpenChange={(open) => !open && setSuspendTarget(null)}
        title={`Suspend ${suspendTarget?.fullName}?`}
        description="They won't be able to sign in until reactivated. All active sessions stay valid until the access token expires (~15 min)."
        confirmLabel="Suspend"
        destructive
        onConfirm={async () => {
          if (suspendTarget) await suspend.mutateAsync({ id: suspendTarget.id });
        }}
      />

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={`Reset password for ${resetTarget?.fullName}?`}
        description="A one-time temporary password will be generated. Deliver it out-of-band — they'll be prompted to change it on next sign-in."
        confirmLabel="Generate"
        onConfirm={async () => {
          if (resetTarget) await resetPwd.mutateAsync({ id: resetTarget.id });
        }}
      />
    </div>
  );
}
