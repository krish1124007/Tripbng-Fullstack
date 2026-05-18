'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

const STORAGE_KEY = 'tripbng:pax-book';

export type PaxType = 'ADULT' | 'CHILD' | 'INFANT';
export type PaxTitle = 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS';
export type PaxGender = 'MALE' | 'FEMALE' | 'OTHER';

export interface PaxRecord {
  id: string;
  /** Display label — "Sharma · Adult · Frequent" — built from fields. */
  title: PaxTitle;
  firstName: string;
  lastName: string;
  type: PaxType;
  gender?: PaxGender;
  /** ISO date. */
  dob?: string;
  nationality?: string;
  passportNumber?: string;
  /** ISO date. */
  passportExpiry?: string;
  email?: string;
  phone?: string;
  /** Free-form tags — Family, VIP, Frequent flier, etc. */
  tags?: string[];
  notes?: string;
  /** ISO. Last booking using this pax record (auto-stamped on booking). */
  lastUsedAt?: string;
  /** ISO. Created. */
  createdAt: string;
}

interface PaxBookState {
  records: PaxRecord[];
  hydrated: boolean;
  upsert: (r: Omit<PaxRecord, 'createdAt' | 'id'> & { id?: string }) => string;
  remove: (id: string) => void;
  touch: (id: string) => void;
  hydrate: () => void;
}

function persist(records: PaxRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* fail soft */
  }
}

function makeId() {
  return 'pax_' + Math.random().toString(36).slice(2, 10);
}

export const usePaxBook = create<PaxBookState>((set, get) => ({
  records: [],
  hydrated: false,
  upsert: (r) => {
    const id = r.id ?? makeId();
    const existing = get().records.find((x) => x.id === id);
    const next: PaxRecord = {
      id,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastUsedAt: existing?.lastUsedAt,
      ...r,
    };
    set((s) => {
      const list = existing
        ? s.records.map((x) => (x.id === id ? next : x))
        : [next, ...s.records];
      persist(list);
      return { records: list };
    });
    return id;
  },
  remove: (id) => {
    set((s) => {
      const list = s.records.filter((x) => x.id !== id);
      persist(list);
      return { records: list };
    });
  },
  touch: (id) => {
    set((s) => {
      const list = s.records.map((x) =>
        x.id === id ? { ...x, lastUsedAt: new Date().toISOString() } : x,
      );
      persist(list);
      return { records: list };
    });
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const records = raw ? (JSON.parse(raw) as PaxRecord[]) : [];
      set({ records, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

export function usePaxBookHydration() {
  const hydrate = usePaxBook((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
}
