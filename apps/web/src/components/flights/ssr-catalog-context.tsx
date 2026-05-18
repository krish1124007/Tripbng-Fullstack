'use client';

// SsrCatalogContext — shared catalog for the booking-form's three
// pickers (BaggageDetailsPicker, SeatSelectionPicker, SsrPicker).
//
// CURRENT STATE: client-side synthetic catalog.
//   We build a deterministic, plausible catalog from the segments the
//   parent already has — no network call, no auth dance, no race
//   conditions, no "Loading…" stalls. Pickers render data instantly
//   so agents can drive the full booking flow end-to-end while we
//   wait on supplier adapters (TBO / ETRAV / KAFILA) to ship real SSR.
//
// NEXT STEP: wire the real fetch back in here once a supplier returns
//   live data. The pickers consume `{ catalog, isLoading, error }`
//   from this context, so swapping the source is a single-file change.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { buildSyntheticSsrCatalog } from './synthetic-ssr';

export interface SsrMealOption {
  code: string;
  label: string;
  description: string | null;
  pricePaise: number;
  currency: string;
}
export interface SsrBaggageOption {
  code: string;
  label: string;
  weightKg: number;
  pricePaise: number;
  currency: string;
}
export interface SsrSeatOption {
  code: string;
  rowNo: number;
  seatNo: string;
  seatType: string;
  available: boolean;
  pricePaise: number;
  currency: string;
}
export interface SsrSeatRow {
  rowNo: number;
  seats: SsrSeatOption[];
}
export interface SsrCatalogSegment {
  segmentId: string;
  origin: string | null;
  destination: string | null;
  meals: SsrMealOption[];
  baggage: SsrBaggageOption[];
  seatRows: SsrSeatRow[];
  currency: string;
}
export interface SsrCatalog {
  segments: SsrCatalogSegment[];
}

interface SsrCatalogContextValue {
  catalog: SsrCatalog | null;
  isLoading: boolean;
  error: string | null;
  /** True when the provider has enough context to render data. When
   *  false, pickers should self-hide. */
  enabled: boolean;
}

const Ctx = createContext<SsrCatalogContextValue>({
  catalog: null,
  isLoading: false,
  error: null,
  enabled: false,
});

export function useSsrCatalog(): SsrCatalogContextValue {
  return useContext(Ctx);
}

export interface SsrCatalogProviderProps {
  /** Kept on the interface for API symmetry with the eventual real
   *  fetch path — currently unused by the synthetic implementation. */
  supplierCode: string;
  fareToken: string;
  /** The segments the synthesiser builds the catalog from. The
   *  frontend already has these from the cached search result. */
  segments?: Array<{ origin: string; destination: string }>;
  children: ReactNode;
}

export function SsrCatalogProvider({
  segments,
  children,
}: SsrCatalogProviderProps) {
  const value = useMemo<SsrCatalogContextValue>(() => {
    if (!segments || segments.length === 0) {
      return { catalog: null, isLoading: false, error: null, enabled: false };
    }
    const catalog = buildSyntheticSsrCatalog(segments);
    return {
      catalog,
      isLoading: false,
      error: null,
      enabled: true,
    };
  }, [segments]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
