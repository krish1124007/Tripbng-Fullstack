// Legacy placeholder — see /buses/page.tsx note. The new search page
// is /bus/search; this redirect strips any old query params, leaving
// the user on the new landing form. They re-enter their search there.

import { redirect } from 'next/navigation';

export default function BusesSearchLegacyRedirect(): never {
  redirect('/bus');
}
