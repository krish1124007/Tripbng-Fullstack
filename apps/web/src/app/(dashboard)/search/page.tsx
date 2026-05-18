import { redirect } from 'next/navigation';

/**
 * /search has moved to /flights. Permanent redirect for any deeplinks
 * (welcome banner, command palette, mobile bottom-nav, external bookmarks).
 */
export default function SearchRedirect() {
  redirect('/flights');
}
