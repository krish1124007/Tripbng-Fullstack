import Link from 'next/link';
import { ProsePage } from '../_components/page-hero';

const TOC = [
  { id: 'acceptance', label: '1. Acceptance' },
  { id: 'eligibility', label: '2. Eligibility' },
  { id: 'platform', label: '3. The platform' },
  { id: 'wallet', label: '4. Wallet & payments' },
  { id: 'bookings', label: '5. Bookings & tickets' },
  { id: 'cancellations', label: '6. Cancellations & refunds' },
  { id: 'obligations', label: '7. Partner obligations' },
  { id: 'liability', label: '8. Liability & disclaimers' },
  { id: 'termination', label: '9. Termination' },
  { id: 'governing-law', label: '10. Governing law' },
  { id: 'changes', label: '11. Changes to terms' },
  { id: 'contact', label: '12. Contact' },
];

export default function TermsPage() {
  return (
    <ProsePage eyebrow="Legal" title="Terms of service" lastUpdated="14 May 2026" toc={TOC}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the TripBng
        platform, websites, mobile apps, and APIs (collectively, the &ldquo;Service&rdquo;) operated
        by <strong>Tripbng India Private Limited</strong> (&ldquo;TripBng&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;), a company incorporated under the Companies Act, 2013 with its registered
        office in Mumbai, India.
      </p>
      <p>
        By using the Service you accept these Terms. If you do not agree, do not use the Service.
        These Terms together with our <Link href="/privacy">Privacy Policy</Link>,{' '}
        <Link href="/refund">Refund Policy</Link>, and any agreement you have signed with us form
        the entire agreement between you and TripBng.
      </p>

      <h2 id="acceptance">1. Acceptance</h2>
      <p>
        By creating an account, accessing the dashboard, or calling our APIs, you confirm that you
        have read, understood, and agreed to these Terms on behalf of your agency, distributor, or
        legal entity. If you accept these Terms on behalf of another party, you warrant that you
        have authority to do so.
      </p>

      <h2 id="eligibility">2. Eligibility</h2>
      <p>The Service is intended for:</p>
      <ul>
        <li>Indian travel agencies registered under applicable trade authorities</li>
        <li>Distributors and consolidators serving Indian sub-agents</li>
        <li>Operators with valid PAN and, where applicable, GSTIN</li>
      </ul>
      <p>
        You must be 18 years or older and authorised to enter into binding contracts. We reserve
        the right to deny or revoke access if eligibility cannot be verified or if your KYC fails
        review.
      </p>

      <h2 id="platform">3. The platform</h2>
      <p>
        TripBng aggregates flight, hotel, holiday, insurance, and bus inventory from licensed
        suppliers and presents it through a unified booking, ticketing, and reconciliation
        workflow. We are an <em>intermediary</em> facilitating bookings — the actual travel
        contract is between you (or your end customer) and the underlying carrier or supplier.
      </p>

      <h2 id="wallet">4. Wallet &amp; payments</h2>
      <h3>4.1 Wallet ledger</h3>
      <p>
        Every TripBng account has a real-time wallet. Top-ups via UPI, NEFT, RTGS, or credit
        partners reflect within minutes of bank confirmation. Wallet credits are denominated in
        Indian Rupees (INR) and stored as integer paise; no interest accrues on stored balances.
      </p>
      <h3>4.2 Atomic debits</h3>
      <p>
        Booking debits are atomic with ticket issuance — if a ticket cannot be issued, the wallet
        debit reverses inside the same transaction. There is no window where your wallet appears
        to be debited without a corresponding booking.
      </p>
      <h3>4.3 Service charges</h3>
      <p>
        TripBng applies a per-booking platform fee disclosed at the time of search. GST at the
        prevailing rate is added on top of the platform fee and remitted to the appropriate tax
        authorities.
      </p>

      <h2 id="bookings">5. Bookings &amp; tickets</h2>
      <p>
        All bookings are subject to the fare rules, baggage rules, and cancellation rules published
        by the underlying carrier or supplier. We display the most current rules at the time of
        booking, but the carrier&apos;s rules at the time of travel are the authoritative source.
      </p>
      <p>
        PAX information must be accurate. Name corrections, document changes, and date changes are
        subject to airline penalties not controlled by TripBng.
      </p>

      <h2 id="cancellations">6. Cancellations &amp; refunds</h2>
      <p>
        Cancellation amounts depend on the fare class and the timing of the cancellation. Refunds
        post atomically to your wallet on success; bank-account refunds are subject to the partner
        gateway&apos;s settlement timelines (typically 5–7 working days). See our{' '}
        <Link href="/refund">Refund Policy</Link> for the full breakdown.
      </p>

      <h2 id="obligations">7. Partner obligations</h2>
      <p>By using the Service you agree to:</p>
      <ul>
        <li>Provide accurate KYC and keep documents current</li>
        <li>Not share login credentials; create sub-agent seats instead</li>
        <li>Comply with the Information Technology Act, 2000 and the DPDP Act, 2023</li>
        <li>Not attempt to circumvent rate limits, scrape inventory, or abuse the platform</li>
        <li>Pay all platform fees and applicable taxes when due</li>
      </ul>

      <h2 id="liability">8. Liability &amp; disclaimers</h2>
      <p>
        TripBng is not liable for delays, cancellations, schedule changes, equipment failures,
        denied boarding, or any operational decision of the underlying carrier. Our maximum
        aggregate liability for any claim shall not exceed the platform fees paid to us in the
        twelve (12) months preceding the claim.
      </p>
      <p>
        The Service is provided &ldquo;as is&rdquo;. We do not warrant that the Service will be
        uninterrupted, error-free, or available in any specific geography at any specific time.
      </p>

      <h2 id="termination">9. Termination</h2>
      <p>
        Either party may terminate the agreement with thirty (30) days&apos; written notice. We may
        suspend access immediately if we reasonably believe there is fraud, misuse, regulatory
        risk, or a material breach of these Terms. Outstanding bookings, refunds, and wallet
        balances are reconciled within fifteen (15) working days of termination.
      </p>

      <h2 id="governing-law">10. Governing law</h2>
      <p>
        These Terms are governed by the laws of India. Disputes are subject to the exclusive
        jurisdiction of the courts of Mumbai. Either party may seek interim equitable relief in
        any court of competent jurisdiction.
      </p>

      <h2 id="changes">11. Changes to terms</h2>
      <p>
        We may update these Terms from time to time. Material changes are communicated at least
        fourteen (14) days before they take effect via email and in-dashboard banner. Continued use
        after the effective date constitutes acceptance.
      </p>

      <h2 id="contact">12. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href="mailto:legal@tripbng.com">legal@tripbng.com</a>. For escalations, address letters
        to the Grievance Officer at our registered office.
      </p>
      <blockquote>
        Tripbng India Private Limited<br />
        WeWork BKC, Bandra Kurla Complex, Mumbai 400051<br />
        CIN: U63040MH2022PTC123456 · GSTIN: 27ABCTI1234R1ZX
      </blockquote>
    </ProsePage>
  );
}
