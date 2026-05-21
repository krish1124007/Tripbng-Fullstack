// MockVisaAdapter — deterministic mock that satisfies the full
// VisaSupplierAdapter contract. Used as the default supplier when no real
// VFS/Atlys/embassy integration is configured.

import { randomUUID } from 'node:crypto';
import type { VisaQuote, VisaQuoteRequest } from '@tripbng/shared';
import {
  VisaAdapterError,
  type VisaApplicationStatus,
  type VisaCancelRequest,
  type VisaCancelResponse,
  type VisaCapability,
  type VisaDocumentRequirement,
  type VisaDocumentRequirementsRequest,
  type VisaDocumentRequirementsResponse,
  type VisaDocumentUploadRequest,
  type VisaDocumentUploadResponse,
  type VisaSubmitRequest,
  type VisaSubmitResponse,
  type VisaSupplierAdapter,
  type VisaSupplierCode,
} from './types.js';

const VISA_DOCUMENTS = [
  'Passport (6+ months validity, 2 blank pages)',
  'Two recent passport-size photographs (matte, light background)',
  'Filled visa application form (signed)',
  'Confirmed return ticket itinerary',
  'Hotel booking / proof of accommodation',
  'Bank statements — last 3 months',
  'Income tax returns — last 2 years',
  'Travel insurance ≥ ₹30 lakh medical cover',
] as const;

const VISA_COUNTRY_MAP: Record<
  string,
  { name: string; flag: string; kind: string; tat: string; govt: number }
> = {
  AE: {
    name: 'United Arab Emirates',
    flag: '🇦🇪',
    kind: 'eVisa (30-day tourist)',
    tat: '3–4 working days',
    govt: 6800,
  },
  TH: { name: 'Thailand', flag: '🇹🇭', kind: 'Visa-on-arrival', tat: '7 working days', govt: 2200 },
  SG: { name: 'Singapore', flag: '🇸🇬', kind: 'eVisa', tat: '5–7 working days', govt: 2800 },
  JP: { name: 'Japan', flag: '🇯🇵', kind: 'Sticker visa', tat: '10–14 working days', govt: 450 },
  GB: {
    name: 'United Kingdom',
    flag: '🇬🇧',
    kind: 'Standard visitor',
    tat: '15+ working days',
    govt: 11400,
  },
  US: {
    name: 'United States',
    flag: '🇺🇸',
    kind: 'B1/B2 Tourist',
    tat: '30+ working days',
    govt: 16500,
  },
  AU: {
    name: 'Australia',
    flag: '🇦🇺',
    kind: 'eVisitor (subclass 651)',
    tat: '8–10 working days',
    govt: 9200,
  },
  TR: { name: 'Türkiye', flag: '🇹🇷', kind: 'eVisa', tat: '2–3 working days', govt: 4000 },
};

interface MockApplicationState {
  supplierBookingRef: string;
  bookingCode: string;
  country: string;
  applicantCount: number;
  state: VisaApplicationStatus['state'];
  createdAt: Date;
}
const mockApplications = new Map<string, MockApplicationState>();

export class MockVisaAdapter implements VisaSupplierAdapter {
  readonly code: VisaSupplierCode = 'MOCK_VISA';
  readonly name = 'TripBng Mock Visa Partner';
  readonly capabilities: readonly VisaCapability[] = [
    'QUOTE',
    'DOCUMENT_REQUIREMENTS',
    'SUBMIT',
    'UPLOAD_DOCUMENT',
    'FETCH_STATUS',
    'CANCEL',
  ];

  async quote(req: VisaQuoteRequest): Promise<VisaQuote> {
    const c = VISA_COUNTRY_MAP[req.country] ?? VISA_COUNTRY_MAP.AE!;
    const applicants = req.applicants;
    const serviceFee = 1499 * applicants;
    const courierFee = 350;
    const govtFee = c.govt * applicants;
    const validFrom = new Date(req.travelDate);
    const validUntil = new Date(req.travelDate.getTime() + 90 * 24 * 3600 * 1000);
    return {
      countryName: c.name,
      countryCode: req.country,
      flag: c.flag,
      visaKind: c.kind,
      processingDays: c.tat,
      govtFeeRupees: govtFee,
      serviceFeeRupees: serviceFee,
      courierFeeRupees: courierFee,
      totalRupees: govtFee + serviceFee + courierFee,
      applicants,
      validFrom: validFrom.toISOString().slice(0, 10),
      validUntil: validUntil.toISOString().slice(0, 10),
      documents: [...VISA_DOCUMENTS],
    };
  }

  async getDocumentRequirements(
    req: VisaDocumentRequirementsRequest,
  ): Promise<VisaDocumentRequirementsResponse> {
    const passportPhoto: VisaDocumentRequirement = {
      code: 'PASSPORT_PHOTO',
      label: 'Recent passport-size photograph',
      description: 'Matte finish, white background. Taken in the last 6 months.',
      required: true,
      acceptedFormats: ['image/jpeg', 'image/png'],
      maxSizeBytes: 5 * 1024 * 1024,
      photoSpec: {
        widthPx: 600,
        heightPx: 600,
        background: 'White',
        headPositionNote: 'Face centered, 70-80% of frame.',
      },
    };
    const passportScan: VisaDocumentRequirement = {
      code: 'PASSPORT_FIRST_PAGE',
      label: 'Passport bio-data page',
      description: 'Clear scan of the page with photo + personal details.',
      required: true,
      acceptedFormats: ['application/pdf', 'image/jpeg', 'image/png'],
      maxSizeBytes: 10 * 1024 * 1024,
    };
    const supportingDocs: VisaDocumentRequirement[] =
      req.purpose === 'BUSINESS'
        ? [
            {
              code: 'INVITATION_LETTER',
              label: 'Business invitation letter (host company)',
              required: true,
              acceptedFormats: ['application/pdf'],
              maxSizeBytes: 10 * 1024 * 1024,
            },
            {
              code: 'GST_CERTIFICATE',
              label: 'GST registration (employer)',
              required: false,
              acceptedFormats: ['application/pdf'],
              maxSizeBytes: 5 * 1024 * 1024,
            },
          ]
        : [
            {
              code: 'BANK_STATEMENT',
              label: 'Bank statement (last 3 months)',
              required: true,
              acceptedFormats: ['application/pdf'],
              maxSizeBytes: 10 * 1024 * 1024,
            },
            {
              code: 'HOTEL_BOOKING',
              label: 'Hotel reservation confirmation',
              required: true,
              acceptedFormats: ['application/pdf'],
              maxSizeBytes: 5 * 1024 * 1024,
            },
            {
              code: 'FLIGHT_ITINERARY',
              label: 'Return ticket itinerary',
              required: true,
              acceptedFormats: ['application/pdf'],
              maxSizeBytes: 5 * 1024 * 1024,
            },
          ];

    return {
      requirements: [passportPhoto, passportScan, ...supportingDocs],
      notes: [
        `Country: ${req.country}`,
        `Purpose: ${req.purpose}`,
        req.applicantType === 'CHILD'
          ? "Minor applicants additionally need parental consent and the parent's passport bio-data page."
          : null,
      ].filter((s): s is string => !!s),
    };
  }

  async submitApplication(req: VisaSubmitRequest): Promise<VisaSubmitResponse> {
    if (!req.applicants || req.applicants.length === 0) {
      throw new VisaAdapterError(
        'BAD_REQUEST',
        'mock-visa submit: at least one applicant required',
        this.code,
      );
    }
    const supplierBookingRef = `MOCK-VSA-${randomUUID().slice(0, 8)}`;
    mockApplications.set(supplierBookingRef, {
      supplierBookingRef,
      bookingCode: req.bookingCode,
      country: req.country,
      applicantCount: req.applicants.length,
      state: 'SUBMITTED',
      createdAt: new Date(),
    });
    const c = VISA_COUNTRY_MAP[req.country] ?? VISA_COUNTRY_MAP.AE!;
    return {
      supplierBookingRef,
      portalUrl: `https://mock.tripbng.local/visa/portal/${supplierBookingRef}`,
      estimatedProcessingDays: c.tat,
      status: 'SUBMITTED',
    };
  }

  async uploadDocument(req: VisaDocumentUploadRequest): Promise<VisaDocumentUploadResponse> {
    const state = mockApplications.get(req.supplierBookingRef);
    if (!state) {
      throw new VisaAdapterError(
        'NOT_FOUND',
        `mock-visa upload: unknown supplierBookingRef ${req.supplierBookingRef}`,
        this.code,
      );
    }
    // Synthetic validation — reject obviously-zero-byte uploads.
    if (!req.fileBuffer || req.fileBuffer.length === 0) {
      return {
        supplierDocumentId: '',
        accepted: false,
        rejectionReason: 'empty file body',
      };
    }
    return {
      supplierDocumentId: `MOCK-DOC-${randomUUID().slice(0, 8)}`,
      accepted: true,
    };
  }

  async fetchStatus(supplierBookingRef: string): Promise<VisaApplicationStatus> {
    const state = mockApplications.get(supplierBookingRef);
    if (!state) {
      throw new VisaAdapterError(
        'NOT_FOUND',
        `mock-visa fetchStatus: unknown supplierBookingRef ${supplierBookingRef}`,
        this.code,
      );
    }
    return {
      supplierBookingRef,
      state: state.state,
      lastUpdated: state.createdAt.toISOString(),
    };
  }

  async cancel(req: VisaCancelRequest): Promise<VisaCancelResponse> {
    const state = mockApplications.get(req.supplierBookingRef);
    if (!state) {
      throw new VisaAdapterError(
        'NOT_FOUND',
        `mock-visa cancel: unknown supplierBookingRef ${req.supplierBookingRef}`,
        this.code,
      );
    }
    // Cancellation only valid pre-submission to embassy. Mock model: once
    // SUBMITTED → cancellable; once GRANTED/REJECTED → not.
    if (state.state === 'GRANTED' || state.state === 'REJECTED') {
      return {
        status: 'NOT_CANCELLABLE',
        failureReason: `application already in terminal state ${state.state}`,
      };
    }
    state.state = 'WITHDRAWN';
    return {
      status: 'WITHDRAWN',
      refundPaise: 0, // mock keeps the service fee on cancellation
    };
  }
}

export function _resetMockVisaState(): void {
  mockApplications.clear();
}
