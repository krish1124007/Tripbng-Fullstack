import Link from 'next/link';
import { ProsePage } from '../_components/page-hero';

const TOC = [
  { id: 'who', label: 'Who we are' },
  { id: 'what', label: 'What we collect' },
  { id: 'why', label: 'Why we collect it' },
  { id: 'share', label: 'Who we share with' },
  { id: 'storage', label: 'How we store + secure' },
  { id: 'retention', label: 'How long we keep it' },
  { id: 'rights', label: 'Your rights' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'transfers', label: 'International transfers' },
  { id: 'children', label: 'Children’s data' },
  { id: 'changes', label: 'Changes' },
  { id: 'contact', label: 'Contact the DPO' },
];

export default function PrivacyPage() {
  return (
    <ProsePage eyebrow="Legal" title="Privacy policy" lastUpdated="14 May 2026" toc={TOC}>
      <p>
        Tripbng India Private Limited (&ldquo;TripBng&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
        respects your privacy. This policy explains what personal data we collect, why we collect
        it, how we secure it, and what rights you have under the Digital Personal Data Protection
        Act, 2023 (&ldquo;DPDP Act&rdquo;) and other applicable laws.
      </p>

      <h2 id="who">Who we are</h2>
      <p>
        We are a private limited company registered in India. Our registered office is at WeWork
        BKC, Mumbai. For matters of personal data, our Data Protection Officer (DPO) is reachable
        at <a href="mailto:dpo@tripbng.com">dpo@tripbng.com</a>.
      </p>

      <h2 id="what">What we collect</h2>
      <h3>Account &amp; KYC</h3>
      <ul>
        <li>Legal entity details: PAN, GSTIN, IATA / TAFI accreditation</li>
        <li>Authorised signatory details: name, mobile, email</li>
        <li>Address proof and bank-account verification documents</li>
      </ul>
      <h3>Booking data</h3>
      <ul>
        <li>Passenger name, gender, date of birth, nationality</li>
        <li>Passport number / expiry (for international travel)</li>
        <li>Contact details for delivery of itineraries and tickets</li>
      </ul>
      <h3>Usage &amp; device</h3>
      <ul>
        <li>IP address, device type, browser, OS for security and abuse prevention</li>
        <li>Pages visited and actions taken inside the dashboard (anonymised after 90 days)</li>
      </ul>

      <h2 id="why">Why we collect it</h2>
      <ol>
        <li>To provision and operate the platform you signed up for</li>
        <li>To comply with regulatory obligations (KYC, GST, AML, DPDP)</li>
        <li>To process bookings with airlines, hotels, GDS, and payment gateways</li>
        <li>To prevent fraud, investigate abuse, and resolve disputes</li>
        <li>To improve the product and provide trade-desk support</li>
      </ol>

      <h2 id="share">Who we share with</h2>
      <p>We share strictly the minimum data required to complete a transaction with:</p>
      <ul>
        <li>Airlines, GDS aggregators, hotel suppliers, charter operators</li>
        <li>Payment gateways (ICICI Bank, PhonePe) for top-ups and refunds</li>
        <li>Tax authorities for GST filings</li>
        <li>Cloud infrastructure providers (AWS Mumbai, MongoDB Atlas) under signed DPAs</li>
        <li>Law-enforcement agencies when lawfully required</li>
      </ul>
      <p>
        We do not sell personal data and we do not share it with advertisers. We have signed Data
        Protection Agreements with every processor that handles personal data on our behalf.
      </p>

      <h2 id="storage">How we store + secure</h2>
      <ul>
        <li>TLS 1.3 in transit; AES-256 encryption at rest in MongoDB Atlas</li>
        <li>Field-level encryption for PAN, GSTIN, and passport numbers</li>
        <li>bcrypt password hashing (cost factor 12); mandatory 2FA for super-admins</li>
        <li>Audit logs on every privileged action with tamper-evident chaining</li>
        <li>Annual SOC 2 audit (in flight); ISO 27001 in progress</li>
      </ul>

      <h2 id="retention">How long we keep it</h2>
      <ul>
        <li>KYC documents: 7 years after account closure (regulatory requirement)</li>
        <li>Booking records and GST invoices: 7 years (Income Tax Act)</li>
        <li>Behavioural / analytics logs: 90 days, then anonymised</li>
        <li>Marketing contact data: until you opt out</li>
      </ul>

      <h2 id="rights">Your rights</h2>
      <p>Under the DPDP Act, you have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you</li>
        <li>Request correction of inaccurate data</li>
        <li>Request erasure (subject to legal retention obligations)</li>
        <li>Withdraw consent at any time for processing based on consent</li>
        <li>Nominate someone to exercise your rights on your behalf</li>
        <li>File a complaint with the Data Protection Board of India</li>
      </ul>
      <p>
        To exercise any of these rights, write to{' '}
        <a href="mailto:dpo@tripbng.com">dpo@tripbng.com</a> with proof of identity. We respond
        within 30 days.
      </p>

      <h2 id="cookies">Cookies</h2>
      <p>
        We use strictly necessary cookies for authentication and CSRF protection, and aggregated
        analytics cookies that do not identify individuals. We do not use advertising cookies,
        third-party trackers, or fingerprinting. You can opt out of analytics in your account
        settings.
      </p>

      <h2 id="transfers">International transfers</h2>
      <p>
        Personal data is primarily stored in the Mumbai (ap-south-1) AWS region. Limited cross-
        border transfer happens when you book international flights — only the data the destination
        carrier needs to issue the ticket leaves India.
      </p>

      <h2 id="children">Children&apos;s data</h2>
      <p>
        The Service is not directed at children under 18. We do not knowingly collect personal data
        from minors. When a parent or guardian books travel for a child, the data they provide is
        used only to process that booking.
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        Material changes to this policy are communicated at least 14 days before they take effect
        via email and in-dashboard banner. The current version is always available at this URL.
      </p>

      <h2 id="contact">Contact the DPO</h2>
      <blockquote>
        Data Protection Officer<br />
        Tripbng India Private Limited<br />
        WeWork BKC, Bandra Kurla Complex, Mumbai 400051<br />
        <a href="mailto:dpo@tripbng.com">dpo@tripbng.com</a> · +91 22 6196 4040
      </blockquote>
      <p>
        For data-related complaints not resolved at the DPO level, you may approach the Data
        Protection Board of India per the DPDP Act, 2023.{' '}
        <Link href="/dpdp">Read our DPDP Act summary</Link>.
      </p>
    </ProsePage>
  );
}
