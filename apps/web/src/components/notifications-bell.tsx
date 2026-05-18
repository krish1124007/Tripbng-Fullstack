'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellRing, CheckCheck, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicNotification } from '@tripbng/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DrawerContent,
  EmptyState,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// NotificationsBell — top-bar bell icon with unread count, opens a right-side drawer with
// the user's notification feed. Polls for unread count every 60s; the feed itself fetches
// when the drawer opens.
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const invalidate = useInvalidateOnSuccess([
    ['notifications', 'unread'],
    ['notifications', 'list'],
  ]);

  const unread = useApiQuery<{ count: number }>(
    ['notifications', 'unread'],
    '/api/v1/notifications/unread-count',
    { staleTime: 30_000 },
  );

  const list = useApiPaginatedQuery<PublicNotification>(
    ['notifications', 'list'],
    '/api/v1/notifications',
    { query: { limit: 20 }, enabled: open },
  );

  const markRead = useApiMutation<{ id: string }, PublicNotification>(
    (i) => `/api/v1/notifications/${i.id}/read`,
    'POST',
    {
      onSuccess: () => invalidate(),
      onError: (err) => toast.error(err.message),
    },
  );

  const markAll = useApiMutation<Record<string, never>, { matched: number; modified: number }>(
    '/api/v1/notifications/read-all',
    'POST',
    {
      onSuccess: () => invalidate(),
      onError: (err) => toast.error(err.message),
    },
  );

  const count = unread.data?.count ?? 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        onClick={() => setOpen(true)}
        className="relative"
      >
        {count > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {count > 0 ? (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-accent px-1 font-mono text-[9px] font-medium text-white">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent width="w-[420px]">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>Notifications</DialogTitle>
              <DialogClose asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => markAll.mutate({})}
                  disabled={count === 0 || markAll.isPending}
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {list.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-md bg-surface-2" />
                ))}
              </div>
            ) : (list.data?.data ?? []).length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No notifications yet"
                description="Booking updates, top-up approvals, and nudges will appear here."
              />
            ) : (
              (list.data?.data ?? []).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.read) markRead.mutate({ id: n.id });
                    if (n.href) {
                      setOpen(false);
                      router.push(n.href);
                    }
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left transition',
                    n.read ? 'bg-surface-1 hover:bg-surface-2' : 'border-accent/30 bg-accent-soft',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1 h-2 w-2 shrink-0 rounded-full',
                      n.read ? 'bg-ink-4' : 'bg-accent',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-ink-1">{n.title}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {n.category}
                      </Badge>
                    </span>
                    <span className="block text-xs text-ink-3">{n.body}</span>
                    <span className="mt-1 block font-mono text-[10px] text-ink-3">
                      {new Date(n.createdAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </span>
                </button>
              ))
            )}
          </DialogBody>
        </DrawerContent>
      </Dialog>
    </>
  );
}
