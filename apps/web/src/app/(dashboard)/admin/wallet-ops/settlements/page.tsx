'use client';

// Admin → Wallet ops → Settlements
//
// Daily gateway settlement reconciliation. SUPER_ADMIN only.
//
// Workflow:
//   1. Admin uploads the gateway's settlement CSV via the upload modal
//      (ICICI / PhonePe / Manual). The backend parses it server-side,
//      creates / upserts a SettlementBatch, and runs the reconciliation
//      matcher synchronously.
//   2. The list view shows every batch with status (EXPECTED / RECEIVED /
//      RECONCILED / DISCREPANT). Click a row to expand the discrepancy
//      detail inline — no separate detail route.
//   3. Re-uploading the same (provider, batchDate) overwrites cleanly —
//      useful when the gateway re-issues a corrected file.

import { useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Shield,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

type ProviderCode = 'ICICI_ORANGE_PG' | 'PHONEPE' | 'MANUAL';
type BatchStatus = 'EXPECTED' | 'RECEIVED' | 'RECONCILED' | 'DISCREPANT';

interface SettlementBatchRow {
  _id: string;
  tenantId: string;
  providerCode: ProviderCode;
  batchDate: string;
  status: BatchStatus;
  expectedTransactionCount: number;
  actualTransactionCount: number;
  reconciledCount: number;
  discrepancyCount: number;
  totalGrossAmount: number;
  totalMdrAmount: number;
  totalGstAmount: number;
  totalNetAmount: number;
  csvFilename: string | null;
  uploadedByUserId: string | null;
  reconciledAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DiscrepancyRow {
  kind:
    | 'AMOUNT_MISMATCH'
    | 'STATUS_MISMATCH'
    | 'GATEWAY_HAS_NO_PT'
    | 'PT_NOT_IN_GATEWAY'
    | 'OK_RESOLVED_FROM_PENDING';
  gatewayTxnId?: string;
  paymentTxnCode?: string;
  detail: string;
  ourAmount?: number;
  gatewayAmount?: number;
  ourStatus?: string;
  gatewayStatus?: string;
}

interface SettlementBatchDetail extends SettlementBatchRow {
  discrepancies: DiscrepancyRow[];
}

const STATUS_TABS: { value: BatchStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'RECONCILED', label: 'Reconciled' },
  { value: 'DISCREPANT', label: 'Discrepant' },
];

const PROVIDER_LABEL: Record<ProviderCode, string> = {
  ICICI_ORANGE_PG: 'ICICI Orange PG',
  PHONEPE: 'PhonePe',
  MANUAL: 'Manual',
};

const STATUS_TONE: Record<BatchStatus, string> = {
  EXPECTED: 'bg-surface-2 text-ink-2',
  RECEIVED: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  RECONCILED: 'bg-success/15 text-success',
  DISCREPANT: 'bg-warning/15 text-warning',
};

const DISCREPANCY_LABEL: Record<DiscrepancyRow['kind'], string> = {
  AMOUNT_MISMATCH: 'Amount mismatch',
  STATUS_MISMATCH: 'Status mismatch',
  GATEWAY_HAS_NO_PT: 'Gateway has no PT',
  PT_NOT_IN_GATEWAY: 'PT not in gateway',
  OK_RESOLVED_FROM_PENDING: 'Resolved from pending',
};

const DISCREPANCY_TONE: Record<DiscrepancyRow['kind'], string> = {
  AMOUNT_MISMATCH: 'bg-warning/15 text-warning',
  STATUS_MISMATCH: 'bg-danger/15 text-danger',
  GATEWAY_HAS_NO_PT: 'bg-warning/15 text-warning',
  PT_NOT_IN_GATEWAY: 'bg-danger/15 text-danger',
  OK_RESOLVED_FROM_PENDING: 'bg-success/15 text-success',
};

export default function SettlementsPage() {
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<BatchStatus | 'all'>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const list = useApiQuery<{ rows: SettlementBatchRow[]; total: number }>(
    ['admin', 'settlements', tab],
    '/api/v1/admin/settlement-batches',
    {
      query: tab === 'all' ? { limit: 50 } : { status: tab, limit: 50 },
      enabled: me?.role === 'SUPER_ADMIN',
    },
  );

  // Detail loaded lazily on row expand — the list query strips the
  // `discrepancies` array (potentially hundreds of rows × N batches) so
  // we fetch the full doc only when ops opens one.
  const detail = useApiQuery<SettlementBatchDetail>(
    ['admin', 'settlements', 'detail', expandedId ?? ''],
    `/api/v1/admin/settlement-batches/${expandedId ?? ''}`,
    {
      enabled: !!expandedId && me?.role === 'SUPER_ADMIN',
    },
  );

  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="Settlement reconciliation is restricted to platform super-admins."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Wallet ops"
        title="Settlements"
        description="Daily gateway settlement files. Upload the CSV from your gateway dashboard and the reconciliation matcher will compare it to our PaymentTransaction ledger — flagging mismatches, recovering PENDING payments that the gateway already settled, and surfacing discrepancies inline."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            Upload CSV
          </Button>
        }
      />

      {/* Status tabs */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                t.value === tab
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
              )}
            >
              {t.label}
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Batch list */}
      {list.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !list.data || list.data.rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FileSpreadsheet}
              title="No settlement batches yet"
              description="Upload a gateway settlement CSV to start reconciling."
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-surface-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-3 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-left">Provider</th>
                  <th className="px-3 py-3 text-left">Status</th>
                  <th className="px-3 py-3 text-right">Rows</th>
                  <th className="px-3 py-3 text-right">Reconciled</th>
                  <th className="px-3 py-3 text-right">Discrep.</th>
                  <th className="px-3 py-3 text-right">Gross</th>
                  <th className="px-3 py-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((b) => {
                  const isExpanded = expandedId === b._id;
                  return (
                    <BatchRow
                      key={b._id}
                      batch={b}
                      expanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : b._id)}
                      detail={isExpanded ? detail.data ?? null : null}
                      detailLoading={isExpanded && detail.isLoading}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

function BatchRow({
  batch,
  expanded,
  onToggle,
  detail,
  detailLoading,
}: {
  batch: SettlementBatchRow;
  expanded: boolean;
  onToggle: () => void;
  detail: SettlementBatchDetail | null;
  detailLoading: boolean;
}) {
  const dateStr = useMemo(() => batch.batchDate.slice(0, 10), [batch.batchDate]);

  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b transition-colors hover:bg-surface-2/40',
          expanded && 'bg-surface-2/30',
        )}
        onClick={onToggle}
      >
        <td className="px-3 py-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
          )}
        </td>
        <td className="px-3 py-3 font-mono text-xs text-ink-1">{dateStr}</td>
        <td className="px-3 py-3 text-ink-2">{PROVIDER_LABEL[batch.providerCode]}</td>
        <td className="px-3 py-3">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              STATUS_TONE[batch.status],
            )}
          >
            {batch.status}
          </span>
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-3">
          {batch.actualTransactionCount.toLocaleString('en-IN')}
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">
          {batch.reconciledCount.toLocaleString('en-IN')}
        </td>
        <td
          className={cn(
            'px-3 py-3 text-right font-mono tabular-nums',
            batch.discrepancyCount > 0 ? 'text-warning font-semibold' : 'text-ink-3',
          )}
        >
          {batch.discrepancyCount.toLocaleString('en-IN')}
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">
          {formatPaiseAsINR(batch.totalGrossAmount, { compact: true })}
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">
          {formatPaiseAsINR(batch.totalNetAmount, { compact: true })}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b bg-surface-2/20">
          <td colSpan={9} className="px-6 py-4">
            {detailLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !detail ? (
              <p className="text-xs text-ink-3">Could not load detail.</p>
            ) : (
              <BatchDetail batch={detail} />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BatchDetail({ batch }: { batch: SettlementBatchDetail }) {
  // Summary KVs.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <KV label="MDR" value={formatPaiseAsINR(batch.totalMdrAmount, { compact: true })} />
        <KV label="GST on MDR" value={formatPaiseAsINR(batch.totalGstAmount, { compact: true })} />
        <KV label="CSV filename" value={batch.csvFilename ?? '—'} />
        <KV
          label="Reconciled at"
          value={batch.reconciledAt ? new Date(batch.reconciledAt).toLocaleString('en-IN') : '—'}
        />
      </div>

      {batch.notes ? (
        <p className="rounded-md border border-strong/60 bg-surface-1 p-3 text-xs text-ink-2">
          <span className="font-semibold text-ink-3">Notes: </span>
          {batch.notes}
        </p>
      ) : null}

      {batch.discrepancies.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
          No discrepancies — every gateway row matches our PaymentTransaction ledger.
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-warning">
            <AlertOctagon className="h-4 w-4" strokeWidth={1.75} />
            {batch.discrepancies.length} discrepanc
            {batch.discrepancies.length === 1 ? 'y' : 'ies'}
          </div>
          <div className="overflow-hidden rounded-md border border-strong/60">
            <table className="w-full text-xs">
              <thead className="bg-surface-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-3 py-2 text-left">Gateway txn</th>
                  <th className="px-3 py-2 text-left">PT code</th>
                  <th className="px-3 py-2 text-right">Our amount</th>
                  <th className="px-3 py-2 text-right">Gateway amount</th>
                  <th className="px-3 py-2 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {batch.discrepancies.map((d, i) => (
                  <tr
                    key={`${d.kind}-${d.gatewayTxnId ?? d.paymentTxnCode ?? i}-${i}`}
                    className="border-t bg-surface-1"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                          DISCREPANCY_TONE[d.kind],
                        )}
                      >
                        {DISCREPANCY_LABEL[d.kind]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-2">
                      {d.gatewayTxnId ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-2">
                      {d.paymentTxnCode ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {typeof d.ourAmount === 'number'
                        ? formatPaiseAsINR(d.ourAmount, { compact: true })
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {typeof d.gatewayAmount === 'number'
                        ? formatPaiseAsINR(d.gatewayAmount, { compact: true })
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{d.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className="mt-0.5 text-ink-1 break-words">{value}</p>
    </div>
  );
}

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [providerCode, setProviderCode] = useState<ProviderCode>('ICICI_ORANGE_PG');
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateOnSuccess([['admin', 'settlements']]);

  const upload = useApiMutation<
    {
      providerCode: ProviderCode;
      batchDate: string;
      csvText: string;
      csvFilename?: string;
      notes?: string;
    },
    {
      batchId: string;
      matchedCount: number;
      resolvedCount: number;
      discrepancyCount: number;
      parsedRowCount: number;
    }
  >(() => '/api/v1/admin/settlement-batches', 'POST', {
    onSuccess: (out) => {
      invalidate();
      const tone =
        out.discrepancyCount > 0
          ? `with ${out.discrepancyCount} discrepancy/discrepancies — open the row to review`
          : 'with no discrepancies';
      toast.success(
        `Reconciled ${out.matchedCount} of ${out.parsedRowCount} rows ${tone}.`,
      );
      reset();
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof ApiCallError ? err.message : 'Upload failed'),
  });

  function reset(): void {
    setCsvText('');
    setCsvFilename(null);
    setNotes('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error('CSV file is over 5 MB. Trim it down before uploading.');
      return;
    }
    setCsvFilename(file.name);
    file.text().then(setCsvText).catch(() => toast.error('Could not read file as text.'));
  }

  function submit(): void {
    if (!csvText.trim()) {
      toast.error('Pick a CSV file first.');
      return;
    }
    upload.mutate({
      providerCode,
      batchDate,
      csvText,
      ...(csvFilename ? { csvFilename } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload settlement CSV</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                Provider
              </span>
              <select
                className="mt-1 h-9 w-full rounded-md border border-strong bg-surface-1 px-3 text-sm"
                value={providerCode}
                onChange={(e) => setProviderCode(e.target.value as ProviderCode)}
              >
                <option value="ICICI_ORANGE_PG">ICICI Orange PG</option>
                <option value="PHONEPE">PhonePe</option>
                <option value="MANUAL">Manual</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                Batch date
              </span>
              <Input
                type="date"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
                className="mt-1"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              CSV file
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,application/vnd.ms-excel"
              onChange={handleFile}
              className="mt-1 block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            />
            {csvFilename ? (
              <p className="mt-1 text-xs text-ink-3">
                Selected: <span className="font-mono">{csvFilename}</span> (
                {Math.ceil(csvText.length / 1024)} KB)
              </p>
            ) : null}
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              Notes (optional)
            </span>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. re-uploaded after gateway corrected MDR column"
              className="mt-1"
              maxLength={1000}
            />
          </label>

          <p className="rounded-md border border-strong/60 bg-surface-2/40 p-3 text-xs text-ink-3">
            Re-uploading the same provider + date overwrites the previous batch. The
            reconciliation matcher runs immediately and discrepancies appear inline
            on the list page.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={upload.isPending}>
            <Upload className="h-4 w-4" />
            Upload &amp; reconcile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
