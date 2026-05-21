'use client';

// WebCheckInButton — booking-detail CTA that opens the airline's web
// check-in page in a new tab.
//
// Visibility rules:
//   • Status must be TICKETED (we don't show for HOLD / CONFIRMED that
//     haven't ticketed yet — there's no airline PNR to pass).
//   • `airlinePnr` must be populated (PENDING_MANUAL bookings have
//     `pnr` but no `airlinePnr` until ops issues).
//   • The first segment's airline must be in our directory. Carriers
//     we don't have an entry for hide the button entirely rather than
//     show a broken link.
//   • The check-in window must be open or about to open. When closed
//     ("departed" / "closes too late") we render a tooltip-only state
//     so the agent knows why no action is available.
//
// The window check uses the FIRST segment's departure time. Multi-
// segment bookings: most carriers let you check in for the whole
// itinerary from the first leg, so this is correct for the common case.
// Edge case (codeshare with different operating carrier per segment)
// is out of scope — the agent can click the carrier-website link
// directly on the airline's own manage-booking page.

import { useMemo } from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  buildCheckInUrl,
  checkInWindow,
  lookupAirlineCheckIn,
} from '@/lib/airline-check-in';

interface BookingSegmentForCheckIn {
  airline: { code: string };
  departure: string | Date;
}

interface PassengerForCheckIn {
  lastName?: string | null;
}

interface BookingForCheckIn {
  status: string;
  airlinePnr?: string | null;
  pnr?: string | null;
  segments: BookingSegmentForCheckIn[];
  passengers: PassengerForCheckIn[];
}

export function WebCheckInButton({ booking }: { booking: BookingForCheckIn }) {
  const cta = useMemo(() => deriveCheckInCta(booking), [booking]);
  if (!cta) return null;

  if (cta.kind === 'OPEN') {
    return (
      <Button variant="secondary" asChild>
        <a href={cta.url} target="_blank" rel="noopener noreferrer">
          <LogIn className="h-4 w-4" /> Web check-in
        </a>
      </Button>
    );
  }
  // Closed window — show a disabled button with the reason in the title.
  return (
    <Button variant="ghost" disabled title={cta.reason}>
      <LogIn className="h-4 w-4 opacity-50" /> Check-in {cta.label}
    </Button>
  );
}

type CheckInCta =
  | { kind: 'OPEN'; url: string; airlineName: string }
  | { kind: 'CLOSED'; label: string; reason: string };

function deriveCheckInCta(booking: BookingForCheckIn): CheckInCta | null {
  if (booking.status !== 'TICKETED') return null;
  const airlinePnr = booking.airlinePnr ?? booking.pnr;
  if (!airlinePnr) return null;
  const firstSeg = booking.segments[0];
  if (!firstSeg) return null;
  const entry = lookupAirlineCheckIn(firstSeg.airline?.code);
  if (!entry) return null;

  const departure = new Date(firstSeg.departure);
  if (Number.isNaN(departure.getTime())) return null;

  const window = checkInWindow(entry, departure);
  if (window.reason === 'TOO_EARLY') {
    const opens = window.opensAt!;
    const hoursAway = Math.round((opens.getTime() - Date.now()) / (60 * 60 * 1000));
    return {
      kind: 'CLOSED',
      label: 'opens later',
      reason: `Check-in opens in ~${hoursAway}h (${entry.opensHoursBefore}h before departure).`,
    };
  }
  if (window.reason === 'DEPARTED') {
    return {
      kind: 'CLOSED',
      label: 'closed',
      reason: 'Flight has already departed.',
    };
  }
  if (window.reason === 'CLOSED') {
    return {
      kind: 'CLOSED',
      label: 'closed',
      reason: `Check-in closes ${entry.closesHoursBefore}h before departure.`,
    };
  }

  // Window open — build the URL.
  const lead = booking.passengers?.[0];
  const lastName = lead?.lastName ?? '';
  const url = buildCheckInUrl(entry, airlinePnr, lastName);
  return { kind: 'OPEN', url, airlineName: entry.name };
}
