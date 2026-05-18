'use client';

// Policy detail / success page.
//
// Two responsibilities:
//   1. Land here right after issuance — celebrate, show the policy number,
//      offer a one-click PDF download.
//   2. Serve as a long-lived deep-link — agencies can come back later and
//      re-download the PDF or initiate cancel/endorse from here.
//
// PDF download routes through our backend proxy (/insurance/policy/:n/pdf)
// so the ASEGO file path never leaks to the browser.

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Download, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent } from '@/components/ui';
import { ApiCallError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';

export default function InsurancePolicyPage() {
  const router = useRouter();
  const params = useParams<{ policyNumber: string }>();
  const policyNumber = params.policyNumber;
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      // Hit the backend proxy with credentials so the auth cookie attaches.
      const res = await fetch(
        `${API_BASE}/api/v1/insurance/policy/${encodeURIComponent(policyNumber)}/pdf`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        throw new ApiCallError('PDF_FAILED', `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${policyNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/insurance')}>
          <ArrowLeft className="h-4 w-4" /> Insurance
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <CheckCircle2 className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div>
            <p className="eyebrow text-brand-600">Policy issued</p>
            <h1 className="mt-1 text-h2 text-ink-1">You're covered</h1>
            <p className="mt-1 text-sm text-ink-3">
              Policy number{' '}
              <span className="font-mono font-semibold text-ink-1">{policyNumber}</span>
            </p>
          </div>

          <div className="mx-auto flex max-w-sm flex-col gap-2">
            <Button onClick={downloadPdf} loading={downloading} size="lg">
              <Download className="h-4 w-4" /> Download PDF
            </Button>
            <Link href="/insurance/buy" className="block">
              <Button variant="secondary" size="sm" className="w-full">
                Buy another policy
              </Button>
            </Link>
          </div>

          <div className="mx-auto max-w-sm space-y-1 rounded-md border bg-surface-2/40 p-3 text-left">
            <p className="text-xs font-semibold text-ink-2">What's next?</p>
            <ul className="space-y-1 text-xs text-ink-3">
              <li>· The PDF is the legal policy document — share with the traveller.</li>
              <li>· Need to cancel? Use the cancel endpoint within the cooling-off period.</li>
              <li>· Trip dates change? Endorse the policy via the endorse endpoint.</li>
            </ul>
          </div>

          <Badge variant="brand" dot className="mx-auto">
            <ShieldCheck className="h-3 w-3" /> Issued via ASEGO
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
