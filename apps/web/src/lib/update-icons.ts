// Icon registry for "What's new" updates. The API stores icons as
// strings (e.g. 'PlaneTakeoff') from the UPDATE_ICON allow-list in
// @tripbng/shared. This map turns the string into a real lucide
// component the UI can render.
//
// Keep in sync with UPDATE_ICON in packages/shared/src/schemas/update.ts —
// adding an icon there requires adding it here, and vice versa.

import {
  ArrowDownToLine,
  Bell,
  Bus,
  CalendarDays,
  CreditCard,
  FileText,
  Hotel,
  Megaphone,
  Plane,
  PlaneTakeoff,
  Receipt,
  ShieldCheck,
  Sparkles,
  Sprout,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UpdateIcon } from '@tripbng/shared';

export const UPDATE_ICON_MAP: Record<UpdateIcon, LucideIcon> = {
  PlaneTakeoff,
  ArrowDownToLine,
  Hotel,
  CalendarDays,
  Sparkles,
  Megaphone,
  ShieldCheck,
  Wallet,
  Bus,
  Plane,
  FileText,
  Receipt,
  Sprout,
  TrendingUp,
  CreditCard,
  Users,
  Bell,
  Zap,
};

/**
 * Format a Date as a short relative-time string ("2 days ago", "1 week
 * ago", "just now"). No external dep — we keep the date math
 * intentionally simple so the dashboard footprint stays tiny.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
