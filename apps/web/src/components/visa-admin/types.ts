import type { AdminVisaProduct } from '@tripbng/shared';

export type TabId =
  | 'basic'
  | 'validity'
  | 'eligibility'
  | 'documents'
  | 'process-steps'
  | 'pricing'
  | 'inclusions'
  | 'exclusions'
  | 'faqs'
  | 'special-notes'
  | 'cancellation';

export interface TabDef {
  id: TabId;
  label: string;
  hint?: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'basic', label: 'Basic details', hint: 'Country, name, mode, banner' },
  { id: 'validity', label: 'Validity & stay', hint: 'Processing + stay days' },
  { id: 'eligibility', label: 'Eligibility', hint: 'Nationality + age rules' },
  { id: 'documents', label: 'Documents', hint: 'Per-applicant checklist' },
  { id: 'process-steps', label: 'Process steps', hint: 'Numbered timeline' },
  { id: 'pricing', label: 'Pricing', hint: 'Fees + pax-band matrix' },
  { id: 'inclusions', label: 'Inclusions', hint: 'What’s in the price' },
  { id: 'exclusions', label: 'Exclusions', hint: 'What’s not' },
  { id: 'faqs', label: 'FAQs', hint: 'Q + A pairs' },
  { id: 'special-notes', label: 'Special notes', hint: 'Caveats / context' },
  { id: 'cancellation', label: 'Cancellation', hint: 'Stage slabs + free text' },
];

/** Used for both `new` and `edit` — `edit` overlays loaded values on top. */
export function emptyProduct(): AdminVisaProduct {
  return {
    countryId: '',
    countryName: '',
    countryIso2: '',
    region: '',
    name: '',
    purpose: 'tourist',
    processingMode: 'e-visa',
    entryType: 'single',
    biometricRequired: false,
    currency: 'INR',
    summary: '',
    bannerImage: undefined,
    gallery: [],
    processingDays: 7,
    validityDays: 90,
    stayDays: 30,
    urgentAvailable: false,
    urgentProcessingDays: undefined,
    urgentSurchargeInr: undefined,
    eligibility: {
      eligibleNationalities: [],
      requiresPriorVisa: false,
    },
    documents: [],
    processSteps: [],
    consulateFeeInr: 0,
    serviceFeeInr: 0,
    priceMatrix: [],
    inclusions: [],
    exclusions: [],
    faqs: [],
    specialNotes: [],
    cancellationPolicyText: [],
    cancellationSchedule: [],
    rating: undefined,
    published: false,
  };
}

/** Generic update helper signature used by every tab component. */
export type UpdateFn = <K extends keyof AdminVisaProduct>(
  key: K,
  value: AdminVisaProduct[K],
) => void;

export interface TabProps {
  product: AdminVisaProduct;
  update: UpdateFn;
}

export function tempId(prefix: string): string {
  return `${prefix}-tmp-${Math.random().toString(36).slice(2, 8)}`;
}
