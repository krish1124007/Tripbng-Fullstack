// PDF download proxy. Looks up the persisted `policyFilePath` for a given
// policy number, then streams ASEGO's `/download?filePath=...` response back
// to the caller. We never expose the raw ASEGO URL — the frontend only ever
// sees /api/v1/insurance/policy/:n/pdf which is gate-kept by our auth.

import type { Response } from 'express';
import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { InsurancePolicy } from '../../models/InsurancePolicy.js';
import { getAsegoContext } from './asego.singleton.js';

export interface DownloadContext {
  tenantId: string;
}

/** Stream the policy PDF directly into an Express response. */
export async function streamPolicyPdf(
  ctx: DownloadContext,
  policyNumber: string,
  res: Response,
): Promise<void> {
  const asego = getAsegoContext();
  if (!asego)
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO insurance not configured' });

  const policy = await InsurancePolicy.findOne({
    tenantId: new Types.ObjectId(ctx.tenantId),
    policyNumber,
  }).lean();
  if (!policy) {
    throw new AppError('NOT_FOUND', { reason: `policy ${policyNumber} not found in this tenant` });
  }
  if (!policy.policyFilePath) {
    throw new AppError('NOT_FOUND', { reason: 'policy has no PDF path on file' });
  }

  // Hit ASEGO directly — bypasses the JSON-parsing path so we can pipe the
  // binary body through without buffering all of it in memory.
  const upstream = await asego.client.getRaw('/download', { filePath: policy.policyFilePath });
  if (!upstream.ok) {
    logger.warn(
      { policyNumber, status: upstream.status, filePath: policy.policyFilePath },
      'asego /download returned non-2xx',
    );
    throw new AppError('NOT_FOUND', { reason: `ASEGO /download failed (${upstream.status})` });
  }

  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${policyNumber}.pdf"`);
  // Stream the ReadableStream from fetch into the Express response.
  if (!upstream.body) {
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO /download returned no body' });
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  res.end();
}
