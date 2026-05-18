/**
 * TripBng / partner brand logo.
 *
 * `<Logo />`                — full partner wordmark (raster-inside-SVG asset at
 *                             /partner-logo.svg, 425×48 native). Sizes via the
 *                             className you pass (e.g. `h-7`, `h-8`, `h-9`).
 * `<Logo variant="mark" />` — square brand glyph for tight spaces / favicons.
 * `<Logo variant="image" />` — back-compat alias for `full`.
 *
 * On dark surfaces (login hero, brand-aurora panels), pass `onDark` so we wrap
 * the logo in a soft white pill — the partner wordmark is a raster, so its
 * colours don't adapt to surface contrast like a pure-text wordmark would.
 */
import Image from 'next/image';
import { cn } from '@/lib/utils';

type Variant = 'full' | 'mark' | 'image';

interface LogoProps {
  variant?: Variant;
  className?: string;
  /** Override the brand-mark accent (only applies to `variant="mark"`). */
  accentClass?: string;
  /** When true, wraps the logo in a soft light pill so it stays legible on
   *  dark surfaces (login hero, brand-aurora panels). */
  onDark?: boolean;
}

export function Logo({
  variant = 'full',
  className,
  accentClass = 'fill-accent-500',
  onDark = false,
}: LogoProps) {
  // Square brand glyph — kept as inline SVG so it can adopt the brand palette
  // and scale crisply at any size. Used by sidebars, favicons, OG marks.
  if (variant === 'mark') {
    return (
      <svg
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="TripBng"
        role="img"
        className={cn('h-8 w-8', className)}
      >
        <rect x="0" y="0" width="32" height="32" rx="8" className="fill-brand-600" />
        <path
          className={accentClass}
          d="M22.4 8.5c.3-.1.6.2.5.5l-.7 2.7-3.6 3.5 2 5.5c.1.3-.2.6-.5.5l-1.7-.6-1.5 2.6c-.2.3-.6.2-.7-.1l-1.6-4.7-4.7-1.6c-.3-.1-.4-.5-.1-.7l2.6-1.5-.6-1.7c-.1-.3.2-.6.5-.5l5.5 2 3.5-3.6 2.6-.8z"
        />
      </svg>
    );
  }

  // `full` and `image` both render the partner wordmark from /public/partner-logo.svg.
  // The SVG embeds a raster, so we serve it via Next/Image with the native intrinsic
  // size (425×48) and let CSS govern the rendered height through the parent span.
  return (
    <span
      className={cn(
        'inline-flex select-none items-center',
        onDark && 'rounded-md bg-white/95 px-2 py-1 shadow-sm dark:bg-white',
        className,
      )}
      aria-label="TripBng"
      role="img"
    >
      <Image
        src="/partner-logo.svg"
        alt="TripBng"
        width={425}
        height={48}
        priority
        unoptimized
        className="h-full w-auto"
      />
    </span>
  );
}
