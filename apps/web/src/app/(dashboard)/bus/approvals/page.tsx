'use client';

// /bus/approvals — two-tab dashboard:
//   • My requests   — `?employeeId=...` filters to that traveller's history
//   • Pending queue — manager's incoming requests (status=pending by default)

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ApprovalListResponse, PublicApproval } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/api-client';

export default function BusApprovalsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <BusApprovalsView />
    </Suspense>
  );
}

function BusApprovalsView(): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const employeeId = search.get('employeeId') ?? '';
  const initialTab = employeeId ? 'mine' : 'pending';
  const [tab, setTab] = useState<'mine' | 'pending'>(initialTab);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Booking · Buses"
        title="Approvals"
        description="Track approval requests + decide on incoming ones."
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.push('/bus')}>
            New search
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="mine" disabled={!employeeId}>
            My requests {employeeId ? '' : '(provide ?employeeId=…)'}
          </TabsTrigger>
          <TabsTrigger value="pending">Pending queue</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {employeeId ? (
            <EmployeeInbox employeeId={employeeId} />
          ) : (
            <EmptyState
              icon={FileText}
              title="No employee context"
              description="Open this page from an employee's submission flow, or add ?employeeId=…"
            />
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          <PendingQueue />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────── Employee inbox ──────────

function EmployeeInbox({ employeeId }: { employeeId: string }): JSX.Element {
  const list = useApiQuery<ApprovalListResponse>(
    ['bus-approvals-mine', employeeId],
    '/api/v1/bus/approvals/mine',
    { query: { employeeId, limit: 50 } },
  );

  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your requests"
        description={list.error?.message ?? '—'}
      />
    );
  }

  const items = list.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No requests yet"
        description="Submit your first bus booking from the search page."
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3">
      {items.map((a) => (
        <li key={a.id}>
          <ApprovalRow approval={a} />
        </li>
      ))}
    </ul>
  );
}

// ────────── Pending queue (manager) ──────────

function PendingQueue(): JSX.Element {
  const list = useApiQuery<ApprovalListResponse>(
    ['bus-approvals-pending'],
    '/api/v1/bus/approvals/pending',
    { query: { limit: 50 } },
  );

  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load the queue"
        description={list.error?.message ?? '—'}
      />
    );
  }

  const items = list.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Inbox zero"
        description="No pending requests right now."
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3">
      {items.map((a) => (
        <li key={a.id}>
          <ApprovalRow approval={a} actionable />
        </li>
      ))}
    </ul>
  );
}

// ────────── Row ──────────

function ApprovalRow({
  approval,
  actionable = false,
}: {
  approval: PublicApproval;
  actionable?: boolean;
}): JSX.Element {
  const [decideDialog, setDecideDialog] = useState<{
    kind: 'approve' | 'reject';
    open: boolean;
  }>({ kind: 'approve', open: false });
  const [note, setNote] = useState('');

  const approve = useApiMutation<{ note?: string }, PublicApproval>(
    () => `/api/v1/bus/approvals/${approval.id}/approve`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Approved — booking will fire next');
        // Quick reload via window so the queue refetches.
        window.location.reload();
      },
      onError: (err) =>
        toast.error(err instanceof ApiCallError ? err.message : 'Approve failed'),
    },
  );

  const reject = useApiMutation<{ note: string }, PublicApproval>(
    () => `/api/v1/bus/approvals/${approval.id}/reject`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Rejected — employee notified');
        window.location.reload();
      },
      onError: (err) =>
        toast.error(err instanceof ApiCallError ? err.message : 'Reject failed'),
    },
  );

  const p = approval.payload;
  const total = (p.estimatedTotalPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-1">
              {p.operatorName || 'Operator'} — {p.busType}
            </p>
            <StatusBadge status={approval.status} />
          </div>
          <p className="text-xs text-ink-3">
            City {p.sourceCityId} → {p.destinationCityId} · {p.doj} · seats {p.seatNumbers.join(', ')}
          </p>
          {approval.policyViolations.length > 0 ? (
            <ul className="space-y-0.5 rounded-md border border-warning/30 bg-warning-soft p-2 text-[11px] text-ink-2">
              {approval.policyViolations.map((v, i) => (
                <li key={i} className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  {v}
                </li>
              ))}
            </ul>
          ) : null}
          {approval.approverNote ? (
            <p className="rounded-md border bg-surface-2/40 p-2 text-[11px] text-ink-2">
              <span className="font-medium">Manager note:</span> {approval.approverNote}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <p className="font-mono text-base font-semibold text-ink-1">₹{total}</p>
          {actionable && approval.status === 'pending' ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setNote('');
                  setDecideDialog({ kind: 'reject', open: true });
                }}
              >
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setNote('');
                  setDecideDialog({ kind: 'approve', open: true });
                }}
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>

      <Dialog
        open={decideDialog.open}
        onOpenChange={(open) => setDecideDialog((d) => ({ ...d, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decideDialog.kind === 'approve' ? 'Approve request?' : 'Reject request?'}
            </DialogTitle>
            <DialogDescription>
              {decideDialog.kind === 'approve'
                ? 'The booking will fire automatically once you approve. Add a note (optional).'
                : 'The employee will see your reason inline. Note must be ≥ 10 characters.'}
            </DialogDescription>
          </DialogHeader>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              decideDialog.kind === 'approve'
                ? 'Optional note for the employee'
                : 'Reason for rejection (≥ 10 chars)'
            }
            className="w-full rounded-md border bg-surface-1 px-2 py-1 text-sm"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDecideDialog((d) => ({ ...d, open: false }))}
              disabled={approve.isPending || reject.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={decideDialog.kind === 'approve' ? 'primary' : 'danger'}
              loading={approve.isPending || reject.isPending}
              onClick={() => {
                if (decideDialog.kind === 'approve') {
                  approve.mutate({ note: note.trim() || undefined });
                } else {
                  if (note.trim().length < 10) {
                    toast.error('Rejection note must be ≥ 10 characters');
                    return;
                  }
                  reject.mutate({ note: note.trim() });
                }
              }}
            >
              {decideDialog.kind === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusBadge({ status }: { status: PublicApproval['status'] }): JSX.Element {
  switch (status) {
    case 'approved':
      return (
        <Badge variant="success" className="text-[10px]">
          <CheckCircle2 className="h-2.5 w-2.5" /> Approved
        </Badge>
      );
    case 'pending':
      return (
        <Badge variant="warning" className="text-[10px]">
          <Clock className="h-2.5 w-2.5" /> Pending
        </Badge>
      );
    case 'rejected':
      return (
        <Badge variant="danger" className="text-[10px]">
          <XCircle className="h-2.5 w-2.5" /> Rejected
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="neutral" className="text-[10px]">
          Expired
        </Badge>
      );
    case 'booked':
      return (
        <Badge variant="brand" className="text-[10px]">
          Booked
        </Badge>
      );
  }
}
