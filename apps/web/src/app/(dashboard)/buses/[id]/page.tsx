// Legacy placeholder — old per-bus detail page (used the mock
// `BusOption` shape from products.ts). The new equivalent is
// /bus/trips/[tripId]; we drop the user back to /bus since the old
// id format doesn't map.

import { redirect } from 'next/navigation';

export default function BusesDetailLegacyRedirect(): never {
  redirect('/bus');
}
