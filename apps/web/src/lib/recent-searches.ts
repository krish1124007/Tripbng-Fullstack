'use client';

import { useEffect, useState, useCallback } from 'react';

const PREFIX = 'tripbng:recent:';
const MAX_PER_PRODUCT = 5;

/**
 * useRecentSearches — per-product search history persisted to localStorage.
 * Stores the last N criteria objects. Callers shape the entry however they need;
 * we only require a `key` for de-duplication (so identical searches don't pile up).
 */
export function useRecentSearches<T extends { key: string }>(product: string) {
  const [items, setItems] = useState<T[]>([]);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + product);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // ignore corrupt cache
    }
  }, [product]);

  const add = useCallback(
    (entry: T) => {
      setItems((prev) => {
        const dedup = prev.filter((p) => p.key !== entry.key);
        const next = [entry, ...dedup].slice(0, MAX_PER_PRODUCT);
        try {
          window.localStorage.setItem(PREFIX + product, JSON.stringify(next));
        } catch {
          // localStorage full or denied — fail soft
        }
        return next;
      });
    },
    [product],
  );

  const remove = useCallback(
    (key: string) => {
      setItems((prev) => {
        const next = prev.filter((p) => p.key !== key);
        try {
          window.localStorage.setItem(PREFIX + product, JSON.stringify(next));
        } catch {
          /* fail soft */
        }
        return next;
      });
    },
    [product],
  );

  const clear = useCallback(() => {
    setItems([]);
    try {
      window.localStorage.removeItem(PREFIX + product);
    } catch {
      /* fail soft */
    }
  }, [product]);

  return { items, add, remove, clear };
}
