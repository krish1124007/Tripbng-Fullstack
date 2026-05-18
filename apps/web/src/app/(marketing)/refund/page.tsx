import Link from 'next/link';
import { ProsePage } from '../_components/page-hero';

const TOC = [
  { id: 'principles', label: 'Refund principles' },
  { id: 'flights', label: 'Flight refunds' },
  { id: 'hotels', label: 'Hotel refunds' },
  { id: 'bus', label: 'Bus refunds' },
  { id: 'holiday', label: 'Holiday & visa' },
  { id: 'platform-fee', label: 'TripBng platform fee' },
  { id: 'wallet', label: 'Wallet vs. bank' },
  { id: 'timeline', label: 'Refund timelines' },
  { id: 'dispute', label: 'Dispute resolution' },
];

export default function RefundPage() {
  return (
    <ProsePage eyebrow="Legal" title="Refund policy" lastUpdated="14 May 2026" toc={TOC}>
      <p>
        This Refund Policy explains how refunds are calculated, processed, and credited when a
        booking is cancelled or fails. It applies to all bookings made through Tripbng India
        Private Limited (&ldquo;TripBng&rdquo;) — flights, hotels, bus, holiday packages, visa, and
        insurance.
      </p>

      <h2 id="principles">Refund principles</h2>
      <ul>
        <li>
          <strong>Atomic refunds.</strong> When a booking fails after payment, the wallet debit
          reverses inside the same transaction. There is no window where your wallet appears
          debited without a corresponding booking.
        </li>
        <li>
          <strong>Wallet-first.</strong> Refunds post first to your TripBng wallet for instant
          availability. You can withdraw to your bank from there, subject to your wallet
          settings.
        </li>
        <li>
          <strong>Transparent fees.</strong> Cancellation amounts charged by the airline or
          supplier are shown upfront on the cancel screen. TripBng does not add a markup on the
          supplier&apos;s cancellation fee.
        </li>
        <li>
          <strong>Auditable.</strong> Every refund creates a ledger entry visible in the Wallet
          section with the corresponding booking reference.
        </li>
      </ul>

      <h2 id="flights">Flight refunds</h2>
      <h3>Voluntary cancellation</h3>
      <p>
        If you cancel a flight booking before the airline&apos;s deadline:
      </p>
      <ul>
        <li>Refund amount = <code>basic fare + taxes − airline cancellation penalty</code></li>
        <li>The penalty is set by the airline and is fare-class specific</li>
        <li>Non-refundable fares only return airline-collected statutory taxes</li>
      </ul>
      <h3>Schedule changes &amp; no-shows</h3>
      <ul>
        <li>If the airline cancels the flight or changes the schedule by more than 2 hours, you can claim a full refund or a free re-accommodation through the trade desk.</li>
        <li>No-shows are at airline discretion; most return only statutory taxes.</li>
      </ul>
      <h3>Ticketing failure</h3>
      <p>
        If ticket issuance fails after a successful wallet debit, the refund is automatic and
        instant — the wallet entry reverses inside the same atomic transaction.
      </p>

      <h2 id="hotels">Hotel refunds</h2>
      <p>
        Hotel cancellation rules are set by the property and shown at booking time. Two common
        patterns:
      </p>
      <ul>
        <li>
          <strong>Free cancellation window.</strong> 100% refund if cancelled before the
          property&apos;s deadline (typically 24–72 hours before check-in).
        </li>
        <li>
          <strong>Non-refundable.</strong> No refund on cancellation. Date changes may be possible
          subject to property policy.
        </li>
      </ul>
      <p>
        No-shows are subject to property policy and typically forfeit the first night&apos;s
        charge.
      </p>

      <h2 id="bus">Bus refunds</h2>
      <p>
        Bus tickets follow the operator&apos;s cancellation grid, typically a sliding scale based
        on time-to-departure. Standard slabs:
      </p>
      <ul>
        <li>More than 24 hours to departure: 10% deduction</li>
        <li>4–24 hours to departure: 30% deduction</li>
        <li>Less than 4 hours to departure: typically non-refundable</li>
      </ul>
      <p>
        Operator-initiated cancellations (vehicle breakdown, route changes) result in 100% refunds
        plus, where applicable, a goodwill credit to your wallet.
      </p>

      <h2 id="holiday">Holiday &amp; visa</h2>
      <p>
        Holiday packages and visa services have their own cancellation grids shown on the booking
        confirmation. Visa application fees, once submitted to the destination consulate, are
        almost always non-refundable irrespective of the application outcome.
      </p>

      <h2 id="platform-fee">TripBng platform fee</h2>
      <p>
        The TripBng platform fee is non-refundable on voluntary cancellations. It is fully
        refundable when the cancellation is caused by:
      </p>
      <ul>
        <li>Supplier-side ticketing failure</li>
        <li>Airline schedule change &gt; 2 hours</li>
        <li>Hotel oversell or property closure</li>
        <li>Operator-initiated bus cancellation</li>
        <li>System errors attributable to TripBng</li>
      </ul>

      <h2 id="wallet">Wallet vs. bank</h2>
      <p>
        By default, all refunds post to your TripBng wallet — instant and reusable. To withdraw
        from wallet to bank, go to Wallet → Withdraw. Bank withdrawals are subject to gateway
        timelines:
      </p>
      <ul>
        <li>UPI: 24 hours</li>
        <li>NEFT / RTGS: 1–3 working days</li>
        <li>IMPS: 1 working day</li>
      </ul>

      <h2 id="timeline">Refund timelines</h2>
      <ul>
        <li>Wallet credit (most cases): <strong>under 60 seconds</strong></li>
        <li>Airline-initiated refunds: typically 5–7 working days after airline acknowledgement</li>
        <li>Hotel and bus operator refunds: 3–10 working days</li>
        <li>Cross-border / international refunds: up to 21 working days</li>
      </ul>
      <p>
        If a refund is overdue, raise it via the dashboard <em>Bookings → Refund tracker</em> or
        email <a href="mailto:refunds@tripbng.com">refunds@tripbng.com</a> with the PNR or booking
        reference. We respond within 24 hours.
      </p>

      <h2 id="dispute">Dispute resolution</h2>
      <ol>
        <li>
          Contact the trade desk through the dashboard chat or call +91 22 6196 4040. Most
          disputes resolve within one business day.
        </li>
        <li>
          If unresolved, email{' '}
          <a href="mailto:grievance@tripbng.com">grievance@tripbng.com</a> for escalation. We aim
          to respond within 5 working days.
        </li>
        <li>
          Beyond that, you may approach the consumer redressal forum at the location of TripBng&apos;s
          registered office, or use the National Consumer Helpline.
        </li>
      </ol>

      <p>
        For the contractual terms governing refunds, see our{' '}
        <Link href="/terms">Terms of Service</Link>. For data-handling questions during a refund,
        see our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </ProsePage>
  );
}
