'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

// Kiwi.com's free airline-logo CDN serves these three sizes. Pick the closest
// asset that's >= the rendered size so the image stays crisp on retina without
// downloading more bytes than needed.
const KIWI_SIZES = [32, 64, 128] as const;
type KiwiSize = (typeof KIWI_SIZES)[number];

function pickKiwiSize(target: number): KiwiSize {
  if (target <= 32) return 32;
  if (target <= 64) return 64;
  return 128;
}

interface AirlineLogoProps {
  /** IATA airline code, e.g. "6E", "AI", "SG". Case-insensitive. */
  code: string;
  /** Full carrier name, used as alt text and hover title. */
  name?: string | null;
  /** Square size in CSS pixels. Defaults to 40 (matches the search-result row). */
  size?: number;
  className?: string;
}

/**
 * Airline logo via Kiwi.com's free CDN
 * (`images.kiwi.com/airlines/{32|64|128}/{IATA}.png`).
 *
 * Falls back to a brand-coloured IATA-code badge when the image 404s — Kiwi
 * covers ~95% of carriers but small regional airlines and recently-rebranded
 * ones aren't there. The fallback keeps the layout stable.
 */
export function AirlineLogo({ code, name, size = 40, className }: AirlineLogoProps) {
  const [errored, setErrored] = useState(false);
  const upperCode = code?.trim().toUpperCase() ?? '';

  if (!upperCode || errored) {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-lg bg-brand-50 font-mono font-bold text-brand-700 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/20',
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.32)) }}
        title={name ?? upperCode}
        aria-label={name ?? upperCode}
      >
        {upperCode || '?'}
      </span>
    );
  }

  return (
    <img
      src={`https://images.kiwi.com/airlines/${pickKiwiSize(size)}/${upperCode}.png`}
      alt={name ?? upperCode}
      title={name ?? upperCode}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      loading="lazy"
      className={cn(
        'shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-stroke-1 dark:bg-ink-9 dark:ring-stroke-2',
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
