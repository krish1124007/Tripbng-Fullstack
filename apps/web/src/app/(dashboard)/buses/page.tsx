// Legacy placeholder — the bus booking module moved to `/bus` (singular)
// when the SeatSeller-backed integration shipped (Phase 3-9). This file
// keeps the old URL working as a hard redirect so existing bookmarks +
// recent-search history don't 404.

import { redirect } from 'next/navigation';

export default function BusesLegacyRedirect(): never {
  redirect('/bus');
}
