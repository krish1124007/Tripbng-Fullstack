// VisaSupplierAdapter — full-lifecycle contract for visa suppliers.
//
// Today only `MockVisaAdapter` exists. A real visa supplier (VFS Global,
// BLS International, Atlys, OneVasco, or direct embassy e-visa APIs) needs
// significantly more than the current `quote(...)` method:
//
//   1. Document checklist per (country × purpose × applicant type)
//   2. Application submission → returns a portal URL where the applicant
//      uploads documents + pays government fees
//   3. Document upload pass-through (we hold copies for re-submission)
//   4. Status polling (submitted → biometrics-pending → processed → granted/rejected)
//   5. Cancellation / withdrawal before submission
//
// Mirror of holiday/types.ts — optional methods so partially-wired adapters
// type-check without throw stubs littering the class.

import type {
  VisaQuote,
  VisaQuoteRequest,
} from '@tripbng/shared';

/** Closed set — every adapter declares which one it represents. */
export type VisaSupplierCode = 'MOCK_VISA' | 'VFS' | 'BLS' | 'ATLYS' | 'EMBASSY' | 'CUSTOM';

export type VisaCapability =
  | 'QUOTE'
  | 'DOCUMENT_REQUIREMENTS'
  | 'SUBMIT'
  | 'UPLOAD_DOCUMENT'
  | 'FETCH_STATUS'
  | 'CANCEL';

// ─────────────────────────────────────────────────────────────────────────────
// Document requirements — per-applicant checklist
// ─────────────────────────────────────────────────────────────────────────────

export interface VisaDocumentRequirementsRequest {
  country: string;
  purpose: 'TOURIST' | 'BUSINESS' | 'STUDENT' | 'TRANSIT' | 'FAMILY';
  /** Applicant type — drives whether minor-specific docs apply. */
  applicantType: 'ADULT' | 'CHILD' | 'INFANT';
  /** Applicant's passport-holder country — affects eligible visa types. */
  nationality: string;
}

export interface VisaDocumentRequirement {
  /** Stable code — e.g. PASSPORT_FIRST_PAGE, BANK_STATEMENT. Used as the
   *  upload form field name. */
  code: string;
  label: string;
  /** Free-form description / specific requirements (e.g. "matte finish,
   *  white background, 35×45mm"). */
  description?: string;
  required: boolean;
  /** Allowed MIME types — caller validates at upload time. */
  acceptedFormats: string[];
  /** Max upload size in bytes. */
  maxSizeBytes: number;
  /** Photo specification when the doc is a photograph. */
  photoSpec?: {
    widthPx?: number;
    heightPx?: number;
    background?: string;
    headPositionNote?: string;
  };
}

export interface VisaDocumentRequirementsResponse {
  requirements: VisaDocumentRequirement[];
  /** Free-form notes from the supplier — embassy-specific rules etc. */
  notes?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit application — creates the supplier-side case
// ─────────────────────────────────────────────────────────────────────────────

export interface VisaApplicant {
  title: 'Mr' | 'Mrs' | 'Miss' | 'Ms' | 'Mstr';
  firstName: string;
  lastName: string;
  paxType: 'ADT' | 'CHD' | 'INF';
  passportNumber: string;
  passportExpiry: string; // ISO yyyy-mm-dd
  passportIssueCountry: string;
  dob: string;
  isLeadPassenger?: boolean;
}

export interface VisaSubmitRequest {
  country: string;
  purpose: 'TOURIST' | 'BUSINESS' | 'STUDENT' | 'TRANSIT' | 'FAMILY';
  /** ISO yyyy-mm-dd — expected entry date into the destination country. */
  expectedTravelDate: string;
  applicants: VisaApplicant[];
  contact: {
    email: string;
    mobile: string;
    countryCode: string;
  };
  /** Mark the application as urgent — drives the supplier's fast-track fee. */
  urgent?: boolean;
  /** Internal booking code for cross-reference in supplier logs. */
  bookingCode: string;
}

export interface VisaSubmitResponse {
  /** Supplier-side application id — persisted as
   *  `VisaBooking.supplierBookingRef`. */
  supplierBookingRef: string;
  /** URL the applicant visits to upload documents + complete biometrics
   *  scheduling. The agency surfaces this in the booking detail page so
   *  the traveller can finish the flow self-service. May be null for
   *  suppliers where uploads go through our API instead. */
  portalUrl?: string;
  /** Supplier-disclosed processing window — humanised (e.g. "3-5 working days"). */
  estimatedProcessingDays: string;
  /** Initial state from the supplier. */
  status: 'SUBMITTED' | 'PENDING_DOCS' | 'FAILED';
  failureReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document upload pass-through
// ─────────────────────────────────────────────────────────────────────────────

export interface VisaDocumentUploadRequest {
  supplierBookingRef: string;
  /** Which applicant the document is for (index into the original
   *  VisaSubmitRequest.applicants array). */
  applicantIndex: number;
  /** Document code from VisaDocumentRequirement.code. */
  documentCode: string;
  /** Raw bytes — caller is responsible for validating size + MIME type
   *  before invoking the adapter. */
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface VisaDocumentUploadResponse {
  /** Supplier-side document id. Useful for re-upload / delete later. */
  supplierDocumentId: string;
  /** Whether the supplier accepted the file (some do a sync validation
   *  pass on upload — bad MIME / dimension / blurriness → rejected here
   *  rather than at processing time). */
  accepted: boolean;
  rejectionReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Application status (polled)
// ─────────────────────────────────────────────────────────────────────────────

export interface VisaApplicationStatus {
  supplierBookingRef: string;
  /** Coarse state. Maps onto the VisaBooking status enum:
   *    SUBMITTED        → IN_PROCESS
   *    BIOMETRICS_DUE   → IN_PROCESS  (caller surfaces the appointment slot)
   *    IN_REVIEW        → IN_PROCESS
   *    GRANTED          → GRANTED
   *    REJECTED         → REJECTED
   *    EXPIRED          → REJECTED
   *    WITHDRAWN        → CANCELLED
   */
  state:
    | 'SUBMITTED'
    | 'BIOMETRICS_DUE'
    | 'IN_REVIEW'
    | 'GRANTED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'WITHDRAWN';
  lastUpdated: string; // ISO datetime
  /** Optional biometrics appointment timestamp. */
  biometricsAt?: string;
  /** When GRANTED — the issued visa number / e-visa file URL. */
  visaNumber?: string;
  visaDocumentUrl?: string;
  /** When REJECTED — embassy / supplier reason. */
  rejectionReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancellation / withdrawal
// ─────────────────────────────────────────────────────────────────────────────

export interface VisaCancelRequest {
  supplierBookingRef: string;
  reason: string;
}

export interface VisaCancelResponse {
  status: 'WITHDRAWN' | 'NOT_CANCELLABLE' | 'FAILED';
  /** Refund — usually zero once the embassy fee is paid; the service fee
   *  may be partially refunded by the supplier. */
  refundPaise?: number;
  failureReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract itself
// ─────────────────────────────────────────────────────────────────────────────

export interface VisaSupplierAdapter {
  readonly code: VisaSupplierCode;
  readonly name: string;
  readonly capabilities: readonly VisaCapability[];

  /** Required — every adapter must quote. */
  quote(req: VisaQuoteRequest): Promise<VisaQuote>;

  getDocumentRequirements?(
    req: VisaDocumentRequirementsRequest,
  ): Promise<VisaDocumentRequirementsResponse>;
  submitApplication?(req: VisaSubmitRequest): Promise<VisaSubmitResponse>;
  uploadDocument?(req: VisaDocumentUploadRequest): Promise<VisaDocumentUploadResponse>;
  fetchStatus?(supplierBookingRef: string): Promise<VisaApplicationStatus>;
  cancel?(req: VisaCancelRequest): Promise<VisaCancelResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class VisaAdapterError extends Error {
  constructor(
    public readonly code:
      | 'NOT_CONFIGURED'
      | 'NOT_IMPLEMENTED'
      | 'BAD_REQUEST'
      | 'NOT_FOUND'
      | 'DOCUMENT_REJECTED'
      | 'SUPPLIER_FAILURE'
      | 'NETWORK_ERROR'
      | 'TIMEOUT',
    message: string,
    public readonly supplierCode: VisaSupplierCode,
    public readonly gatewayCode?: string,
  ) {
    super(message);
    this.name = 'VisaAdapterError';
  }
}
