'use client';

// Admin → Reports → Form 26Q
//
// Quarterly TDS-return preparation. SUPER_ADMIN only.
//
// Pulls TDS_DEDUCT ledger entries for the selected (FY, quarter) and renders
// the Annexure I deductee-detail rows. The CSV download lands an RPU-ready
// file the accountant pastes into the NSDL Return Preparation Utility.
//
// Warnings panel flags agencies missing PAN / deductee-category — those
// rows fail FVU validation, so they need backfilling before the return is
// filable. We show them prominently rather than silently dropping rows.

import { useMemo, useState } from 'react';
import { AlertOctagon, FileDown, FileSpreadsheet, Receipt, Shield } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { downloadAuthenticatedFile } from '@/lib/download';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

interface Form26QRow {
  srNo: number;
  deducteeCode: string;
  deducteeCategory: string | null;
  panOfDeductee: string;
  nameOfDeductee: string;
  address: string;
  sectionCode: string;
  dateOfPaymentOrCredit: string;
  amountPaidOrCreditedPaise: number;
  tdsAmountPaise: number;
  surchargePaise: number;
  hecPaise: number;
  totalTaxDeductedPaise: number;
  dateOfTaxDeduction: string;
  reasonForNonDeduction: string;
  ledgerTxnId: string;
  /** Set when the row aggregator carries the agency id so the UI can
   *  surface a per-deductee Form 16A download. The 26Q export keeps each
   *  row 1:1 with a ledger entry, but the same agency can appear across
   *  multiple rows — we group on the client below for the certificate
   *  list rather than producing N download buttons. */
  agencyId?: string;
}

interface Form26QWarning {
  agencyId: string;
  agencyName: string;
  reasons: string[];
  affectedRowCount: number;
}

interface Form26QReport {
  tenantId: string;
  financialYear: string;
  quarter: Quarter;
  quarterFrom: string;
  quarterTo: string;
  generatedAt: string;
  rows: Form26QRow[];
  totals: {
    deducteeCount: number;
    rowCount: number;
    grossAmountPaise: number;
    tdsAmountPaise: number;
    surchargePaise: number;
    hecPaise: number;
    totalTaxDeductedPaise: number;
  };
  warnings: Form26QWarning[];
}

const QUARTERS: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

/** Pick a sensible default FY — current Indian FY runs Apr 1 → Mar 31, so
 *  Jan-Mar is still the previous calendar year's FY. */
function currentFy(): string {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan
  const year = now.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function currentQuarter(): Quarter {
  const month = new Date().getMonth();
  if (month >= 3 && month <= 5) return 'Q1';
  if (month >= 6 && month <= 8) return 'Q2';
  if (month >= 9 && month <= 11) return 'Q3';
  return 'Q4';
}

const REASON_LABEL: Record<string, string> = {
  MISSING_PAN: 'PAN missing',
  MISSING_PAN_NAME: 'PAN holder name missing',
  MISSING_DEDUCTEE_CATEGORY: 'Deductee category not set',
};

export default function Form26QPage() {
  const me = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [fy, setFy] = useState(currentFy());
  const [quarter, setQuarter] = useState<Quarter>(currentQuarter());
  const [downloading, setDownloading] = useState(false);
  const [downloadingCertId, setDownloadingCertId] = useState<string | null>(null);

  // Build a small list of selectable FYs — current year + the prior two.
  const fyOptions = useMemo(() => {
    const cur = Number(currentFy().slice(0, 4));
    return [cur, cur - 1, cur - 2].map(
      (y) => `${y}-${String(y + 1).slice(-2)}`,
    );
  }, []);

  const query = useApiQuery<Form26QReport>(
    ['admin', 'form-26q', fy, quarter],
    '/api/v1/admin/reports/form-26q',
    {
      query: { fy, quarter },
      enabled: me?.role === 'SUPER_ADMIN',
    },
  );

  const download = async () => {
    setDownloading(true);
    try {
      const qs = new URLSearchParams({ fy, quarter, format: 'csv' });
      await downloadAuthenticatedFile(
        `/api/v1/admin/reports/form-26q?${qs.toString()}`,
        `form-26q-${fy}-${quarter}.csv`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Export failed');
    } finally {
      setDownloading(false);
    }
  };

  // Generate per-deductee Form 16A certificate. The endpoint returns a PDF
  // stream; the agency-code component of the filename keeps multiple
  // certificates from clobbering each other in the user's downloads folder.
  const downloadCertificate = async (agencyId: string, agencyCode: string) => {
    setDownloadingCertId(agencyId);
    try {
      const qs = new URLSearchParams({ fy, quarter, agencyId, format: 'pdf' });
      await downloadAuthenticatedFile(
        `/api/v1/admin/reports/form-16a?${qs.toString()}`,
        `form-16a-${agencyCode}-${fy}-${quarter}.pdf`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Certificate download failed');
    } finally {
      setDownloadingCertId(null);
    }
  };

  // Group Annexure rows into per-deductee certificate aggregates. Drives
  // the "Generate certificates" panel below — one row per agency with the
  // total TDS for the quarter. We dereference query.data inside the hook
  // (rather than via the post-early-return `report` const) so the
  // declaration order survives an early-return reshuffle later.
  const certificates = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    const byAgency = new Map<
      string,
      { agencyId: string; agencyCode: string; name: string; tdsPaise: number; rowCount: number }
    >();
    for (const r of data.rows) {
      if (!r.agencyId) continue;
      const existing = byAgency.get(r.agencyId);
      if (existing) {
        existing.tdsPaise += r.tdsAmountPaise;
        existing.rowCount++;
      } else {
        byAgency.set(r.agencyId, {
          agencyId: r.agencyId,
          // PAN of deductee is unique per agency; fall back to the leading
          // letters of the name as a stable filename hint.
          agencyCode: r.panOfDeductee || r.nameOfDeductee.slice(0, 8).replace(/\s+/g, '_'),
          name: r.nameOfDeductee,
          tdsPaise: r.tdsAmountPaise,
          rowCount: 1,
        });
      }
    }
    return Array.from(byAgency.values()).sort((a, b) => b.tdsPaise - a.tdsPaise);
  }, [query.data]);

  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="Form 26Q preparation is restricted to platform super-admins."
          />
        </CardContent>
      </Card>
    );
  }

  const report = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Reports"
        title="Form 26Q — quarterly TDS return"
        description="Deductee detail (Annexure I) for the quarterly Form 26Q filing. CSV export lands an RPU-ready file the accountant imports into the NSDL Return Preparation Utility."
        actions={
          <Button
            onClick={download}
            loading={downloading}
            disabled={!report || report.rows.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Download CSV
          </Button>
        }
      />

      {/* Period picker */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Financial year
          </span>
          {fyOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setFy(opt)}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                opt === fy
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
              )}
            >
              {opt}
            </button>
          ))}
          <span className="ml-4 text-xs font-semibold uppercase tracking-wider text-ink-3">
            Quarter
          </span>
          {QUARTERS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuarter(q)}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                q === quarter
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
              )}
            >
              {q}
            </button>
          ))}
          <div className="ml-auto text-xs text-ink-3">
            {report ? (
              <>
                {report.quarterFrom} → {report.quarterTo}
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : report ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Deductees" value={report.totals.deducteeCount.toLocaleString('en-IN')} />
          <Kpi label="Rows" value={report.totals.rowCount.toLocaleString('en-IN')} />
          <Kpi
            label="Amount credited"
            value={formatPaiseAsINR(report.totals.grossAmountPaise, { compact: true })}
            tone="brand"
          />
          <Kpi
            label="TDS deducted"
            value={formatPaiseAsINR(report.totals.totalTaxDeductedPaise, { compact: true })}
          />
        </div>
      ) : null}

      {/* Warnings — filing-blocking gaps */}
      {report && report.warnings.length > 0 ? (
        <Card tone="warning">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-warning" strokeWidth={1.75} />
              <h3 className="text-sm font-semibold text-ink-1">
                {report.warnings.length} agencies missing tax-filing data
              </h3>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              These rows fail FVU validation (NSDL rejects deductee rows without PAN). Backfill the
              flagged fields on each agency, then re-run this export.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs">
              {report.warnings.map((w) => (
                <li
                  key={w.agencyId}
                  className="flex items-center justify-between rounded-md border border-strong/60 bg-surface-1 px-3 py-2"
                >
                  <div>
                    <span className="font-medium text-ink-1">{w.agencyName}</span>
                    <span className="ml-2 text-ink-3">
                      ({w.affectedRowCount} row{w.affectedRowCount === 1 ? '' : 's'} affected)
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {w.reasons.map((r) => (
                      <span
                        key={r}
                        className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning"
                      >
                        {REASON_LABEL[r] ?? r}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Per-deductee Form 16A certificates */}
      {report && certificates.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b bg-surface-2/40 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-1">
                Form 16A certificates
              </h3>
              <p className="text-xs text-ink-3">
                Per-deductee TDS certificate (PDF). The accountant fills in the BSR
                code + challan details before issuing to the agency.
              </p>
            </div>
            <span className="text-xs text-ink-3">
              {certificates.length} deductee{certificates.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-surface-1 text-xs font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-2 text-left">Deductee</th>
                  <th className="px-4 py-2 text-right">Deductions</th>
                  <th className="px-4 py-2 text-right">Total TDS</th>
                  <th className="px-4 py-2 text-right">Certificate</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <tr
                    key={c.agencyId}
                    className="border-b transition-colors last:border-b-0 hover:bg-surface-2/40"
                  >
                    <td className="px-4 py-2 text-ink-1">{c.name}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-3">
                      {c.rowCount}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-warning">
                      {formatPaiseAsINR(c.tdsPaise, { compact: true })}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadCertificate(c.agencyId, c.agencyCode)}
                        loading={downloadingCertId === c.agencyId}
                      >
                        <FileDown className="h-4 w-4" />
                        Form 16A PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Annexure I table */}
      {query.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !report || report.rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Receipt}
              title="No TDS deductions in this quarter"
              description="The selected (FY, quarter) has no DI incentive payouts that triggered TDS withholding."
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-surface-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-3 py-3 text-left">Sr.</th>
                  <th className="px-3 py-3 text-left">PAN</th>
                  <th className="px-3 py-3 text-left">Deductee name</th>
                  <th className="px-3 py-3 text-left">Cat.</th>
                  <th className="px-3 py-3 text-left">Sec.</th>
                  <th className="px-3 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-right">Gross</th>
                  <th className="px-3 py-3 text-right">TDS</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={r.ledgerTxnId}
                    className={cn(
                      'border-b transition-colors last:border-b-0 hover:bg-surface-2/40',
                      !r.panOfDeductee && 'bg-warning/5',
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-ink-3 tabular-nums">
                      {r.srNo}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.panOfDeductee || (
                        <span className="text-warning">— missing —</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-1">{r.nameOfDeductee}</td>
                    <td className="px-3 py-2 text-xs text-ink-3">
                      {r.deducteeCategory ?? (
                        <span className="text-warning">— missing —</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.sectionCode}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-3">
                      {r.dateOfPaymentOrCredit}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatPaiseAsINR(r.amountPaidOrCreditedPaise, { compact: true })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-warning">
                      {formatPaiseAsINR(r.tdsAmountPaise, { compact: true })}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 bg-brand-50/40 dark:bg-brand-500/10">
                  <td className="px-3 py-3 font-bold text-ink-1" colSpan={6}>
                    TOTAL ({report.totals.rowCount} rows, {report.totals.deducteeCount}{' '}
                    deductees)
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums font-bold">
                    {formatPaiseAsINR(report.totals.grossAmountPaise, { compact: true })}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums font-bold text-warning">
                    {formatPaiseAsINR(report.totals.totalTaxDeductedPaise, { compact: true })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'brand';
}) {
  return (
    <Card tone={tone === 'brand' ? 'brand' : 'default'}>
      <CardContent className="p-4">
        <p
          className={cn(
            'eyebrow',
            tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3',
          )}
        >
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold tabular-nums text-ink-1">{value}</p>
      </CardContent>
    </Card>
  );
}
