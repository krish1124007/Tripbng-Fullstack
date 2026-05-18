import Link from 'next/link';
import { ProsePage } from '../_components/page-hero';

const TOC = [
  { id: 'summary', label: 'In short' },
  { id: 'principles', label: 'DPDP principles we follow' },
  { id: 'controls', label: 'Technical controls' },
  { id: 'rights', label: 'Your DPDP rights' },
  { id: 'process', label: 'How to file a request' },
  { id: 'breach', label: 'Breach notification' },
  { id: 'dpo', label: 'Data Protection Officer' },
];

export default function DpdpPage() {
  return (
    <ProsePage
      eyebrow="Compliance"
      title="DPDP Act 2023 compliance"
      lastUpdated="14 May 2026"
      toc={TOC}
    >
      <p>
        The Digital Personal Data Protection Act, 2023 (&ldquo;DPDP Act&rdquo;) is India&apos;s
        comprehensive personal data protection law. This page summarises how Tripbng India Private
        Limited (&ldquo;TripBng&rdquo;) complies with the Act and how partners and end users can
        exercise their rights.
      </p>
      <p>
        This page is a plain-language overview, not the full legal document. For the contractual
        terms, see our <Link href="/terms">Terms of Service</Link> and{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2 id="summary">In short</h2>
      <ul>
        <li>
          We are a <strong>Data Fiduciary</strong> under the DPDP Act for the personal data of
          partner agencies, sub-agents, and travel customers booked through our platform.
        </li>
        <li>
          We process personal data only for lawful purposes, with consent or under a legitimate
          use specified by the Act.
        </li>
        <li>
          We notify the Data Protection Board of India and affected principals of any personal-data
          breach without undue delay.
        </li>
        <li>
          Our Data Protection Officer is reachable at{' '}
          <a href="mailto:dpo@tripbng.com">dpo@tripbng.com</a>.
        </li>
      </ul>

      <h2 id="principles">DPDP principles we follow</h2>
      <h3>1. Lawful purpose &amp; consent</h3>
      <p>
        We collect personal data only for clearly stated purposes — running your account,
        processing bookings, complying with regulatory requirements, and providing trade-desk
        support. Where consent is the legal basis, it is freely given, informed, specific, and
        revocable.
      </p>
      <h3>2. Data minimisation</h3>
      <p>
        We collect the minimum data required. We do not aggregate behavioural data into advertising
        profiles. We do not share booking PII with third parties beyond what the underlying
        carrier or supplier needs to complete a transaction.
      </p>
      <h3>3. Accuracy</h3>
      <p>
        Partners can update their KYC, address, and contact information in the dashboard at any
        time. End-customer corrections (name changes on tickets) are subject to airline rules and
        forwarded to the underlying carrier.
      </p>
      <h3>4. Storage limitation</h3>
      <p>
        Personal data is retained only as long as needed for the stated purpose or as legally
        required. See the retention table in our <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <h3>5. Accountability</h3>
      <p>
        Every privileged action on personal data is logged in a tamper-evident audit trail. We
        review access patterns weekly and rotate credentials on a fixed schedule.
      </p>

      <h2 id="controls">Technical controls</h2>
      <ul>
        <li>TLS 1.3 in transit; AES-256-GCM encryption at rest</li>
        <li>Field-level encryption (FLE) for PAN, GSTIN, passport, bank details</li>
        <li>Mandatory two-factor authentication for super-admin and distributor roles</li>
        <li>Role-based access control with permission strings (resource:action:scope)</li>
        <li>Daily backups; quarterly recovery drills</li>
        <li>Cloud workloads pinned to ap-south-1 (Mumbai) by default</li>
        <li>Annual SOC 2 audit (in flight); ISO 27001 in progress</li>
      </ul>

      <h2 id="rights">Your DPDP rights</h2>
      <p>As a Data Principal under the DPDP Act, you have the right to:</p>
      <ol>
        <li>
          <strong>Information.</strong> Know what personal data we hold, the purposes of
          processing, and the identities of any third parties with whom the data is shared.
        </li>
        <li>
          <strong>Correction &amp; erasure.</strong> Ask us to correct inaccurate data or erase
          data that is no longer needed (subject to legal retention obligations).
        </li>
        <li>
          <strong>Grievance redressal.</strong> File a complaint with us; if unresolved, escalate
          to the Data Protection Board of India.
        </li>
        <li>
          <strong>Nominate.</strong> Nominate another individual to exercise your rights in the
          event of death or incapacity.
        </li>
        <li>
          <strong>Withdraw consent.</strong> Withdraw consent at any time where consent was the
          legal basis for processing. We honour withdrawals within 7 working days.
        </li>
      </ol>

      <h2 id="process">How to file a request</h2>
      <ol>
        <li>
          Email <a href="mailto:dpo@tripbng.com">dpo@tripbng.com</a> from the address registered
          on your TripBng account.
        </li>
        <li>
          Include: your name, account ID (if available), the nature of the request (access /
          correction / erasure / nomination / consent withdrawal), and any supporting details.
        </li>
        <li>
          We verify identity within 3 working days and respond substantively within 30 days. If a
          request requires more time we will explain why.
        </li>
        <li>
          If you are not satisfied with our response, you may escalate to the Grievance Officer at
          the same registered office address. Beyond that, the Data Protection Board of India is
          your next forum.
        </li>
      </ol>

      <h2 id="breach">Breach notification</h2>
      <p>
        In the unlikely event of a personal-data breach, we will:
      </p>
      <ul>
        <li>
          Notify the Data Protection Board of India within the timeline specified by the Act and
          its subordinate rules.
        </li>
        <li>
          Notify each affected Data Principal, describing the nature of the breach, the data
          involved, the measures taken, and the remedies available.
        </li>
        <li>
          Publish a public post-incident summary on the <Link href="/status">status page</Link>{' '}
          for transparency, redacting only what is necessary to protect ongoing investigations.
        </li>
      </ul>

      <h2 id="dpo">Data Protection Officer</h2>
      <blockquote>
        Data Protection Officer<br />
        Tripbng India Private Limited<br />
        WeWork BKC, Bandra Kurla Complex, Mumbai 400051<br />
        <a href="mailto:dpo@tripbng.com">dpo@tripbng.com</a> · +91 22 6196 4040
      </blockquote>
      <p>
        For escalations beyond the DPO, write to the Grievance Officer at the same address. The
        Data Protection Board of India is the statutory authority for unresolved complaints.
      </p>
    </ProsePage>
  );
}
