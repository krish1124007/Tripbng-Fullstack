// VFSVisaAdapter — placeholder for the VFS Global visa API integration.
//
// Status: SKELETON. Throws NOT_IMPLEMENTED on every method. Reasons:
//   1. VFS Global B2B API spec + sandbox endpoints not yet delivered by
//      their account team.
//   2. VFS_API_KEY / VFS_API_SECRET env vars not yet provisioned.
//   3. Document-upload portal handoff flow not yet designed — VFS
//      typically returns a tokenised portal URL the applicant follows;
//      we may also need to host the upload pipeline ourselves and
//      stream documents to VFS via their REST endpoints.
//
// When the spec lands:
//   1. Wire `quote()` — VFS pricing API returns govt fee + service fee
//      + courier + biometrics surcharge per applicant.
//   2. Wire `getDocumentRequirements()` against VFS's per-country
//      checklist endpoint (some countries share checklists, others
//      diverge by purpose / nationality).
//   3. Wire `submitApplication()` — creates the case + returns the
//      tokenised portal URL.
//   4. Wire `uploadDocument()` — multipart upload, returns docId.
//   5. Wire `fetchStatus()` against VFS's status API or webhook channel.
//   6. Wire `cancel()` against VFS's withdrawal endpoint.
//
// See apps/api/src/adapters/visa/EMAIL_DRAFT.md for the exact list of
// open questions on the integration.

import type { VisaQuote, VisaQuoteRequest } from '@tripbng/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  VisaAdapterError,
  type VisaApplicationStatus,
  type VisaCancelRequest,
  type VisaCancelResponse,
  type VisaCapability,
  type VisaDocumentRequirementsRequest,
  type VisaDocumentRequirementsResponse,
  type VisaDocumentUploadRequest,
  type VisaDocumentUploadResponse,
  type VisaSubmitRequest,
  type VisaSubmitResponse,
  type VisaSupplierAdapter,
  type VisaSupplierCode,
} from './types.js';

const NOT_IMPLEMENTED =
  'VFS Global adapter not yet implemented — spec pending from VFS account manager. ' +
  'See apps/api/src/adapters/visa/EMAIL_DRAFT.md.';

export class VFSVisaAdapter implements VisaSupplierAdapter {
  readonly code: VisaSupplierCode = 'VFS';
  readonly name = 'VFS Global';
  readonly capabilities: readonly VisaCapability[] = [];

  constructor() {
    logger.warn(
      {
        adapter: 'VFS',
        apiKey: env.VFS_API_KEY ? '(set)' : '(unset)',
        apiSecret: env.VFS_API_SECRET ? '(set)' : '(unset)',
        baseUrl: env.VFS_BASE_URL ?? '(unset)',
      },
      'VFS adapter instantiated as SKELETON — every method throws NOT_IMPLEMENTED',
    );
  }

  async quote(_req: VisaQuoteRequest): Promise<VisaQuote> {
    throw new VisaAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async getDocumentRequirements(
    _req: VisaDocumentRequirementsRequest,
  ): Promise<VisaDocumentRequirementsResponse> {
    throw new VisaAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async submitApplication(_req: VisaSubmitRequest): Promise<VisaSubmitResponse> {
    throw new VisaAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async uploadDocument(_req: VisaDocumentUploadRequest): Promise<VisaDocumentUploadResponse> {
    throw new VisaAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async fetchStatus(_supplierBookingRef: string): Promise<VisaApplicationStatus> {
    throw new VisaAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }

  async cancel(_req: VisaCancelRequest): Promise<VisaCancelResponse> {
    throw new VisaAdapterError('NOT_IMPLEMENTED', NOT_IMPLEMENTED, this.code);
  }
}
