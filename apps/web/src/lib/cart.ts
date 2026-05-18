'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

const STORAGE_KEY = 'tripbng:cart';

export type CartItemKind = 'flight' | 'hotel' | 'bus' | 'holiday' | 'visa' | 'insurance';

export interface CartItem {
  id: string;
  kind: CartItemKind;
  /** Brand or hero label — e.g. "Mock Airways · BOM → DEL". */
  title: string;
  /** Sub-line — times / room type / etc. */
  subtitle?: string;
  /** Primary date — travel / check-in / departing. */
  datePrimary?: string;
  /** Secondary date — return / check-out. */
  dateSecondary?: string;
  /** Total in rupees (already × pax / nights / qty). */
  priceRupees: number;
  /** Pax / rooms / applicants — for display in the line item. */
  qty?: number;
  /** Free-form metadata for the quote builder. */
  meta?: Record<string, unknown>;
  /** ISO timestamp. */
  addedAt: string;
}

interface CartState {
  items: CartItem[];
  hydrated: boolean;
  addItem: (item: Omit<CartItem, 'addedAt'>) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<CartItem>) => void;
  clear: () => void;
  hydrate: () => void;
}

function persist(items: CartItem[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* fail soft if quota exceeded */
  }
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  hydrated: false,
  addItem: (item) => {
    const next: CartItem = { ...item, addedAt: new Date().toISOString() };
    set((s) => {
      const exists = s.items.find((i) => i.id === next.id);
      const list = exists ? s.items.map((i) => (i.id === next.id ? next : i)) : [...s.items, next];
      persist(list);
      return { items: list };
    });
  },
  removeItem: (id) => {
    set((s) => {
      const list = s.items.filter((i) => i.id !== id);
      persist(list);
      return { items: list };
    });
  },
  updateItem: (id, patch) => {
    set((s) => {
      const list = s.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
      persist(list);
      return { items: list };
    });
  },
  clear: () => {
    persist([]);
    set({ items: [] });
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const items = raw ? (JSON.parse(raw) as CartItem[]) : [];
      set({ items, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

// Selectors — keep components tight by exposing common derived values.
export const useCartCount = () => useCart((s) => s.items.length);
export const useCartTotal = () =>
  useCart((s) => s.items.reduce((sum, i) => sum + i.priceRupees, 0));

/**
 * Hydration hook — call once at the dashboard layout level. Without this,
 * the cart starts empty on every navigation because we use vanilla zustand
 * (no persist middleware) for tighter control over storage shape.
 */
export function useCartHydration() {
  const hydrate = useCart((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
}
