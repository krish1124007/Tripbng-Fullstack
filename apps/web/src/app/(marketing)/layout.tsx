import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { MarketingNav } from './_components/marketing-nav';
import { MarketingFooter } from './_components/marketing-footer';

export const metadata: Metadata = {
  title: 'TripBng — B2B travel platform for India’s travel trade',
  description:
    'Search, hold, ticket, and reconcile — every paisa traceable. Series fares, distributor cockpits, transparent ledger. Built for India’s travel agencies.',
  openGraph: {
    title: 'TripBng — B2B travel platform for India’s travel trade',
    description:
      'Series + GDS in one search. Real-time wallet, distributor cockpit, GST-clean invoicing. Onboard in 24 hours.',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
    type: 'website',
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // Force light theme on marketing pages — brand consistency for first-time visitors.
    // The dashboard's data-theme switcher does not propagate here.
    <div data-theme="light" className="min-h-screen bg-surface-1" style={{ scrollBehavior: 'smooth' }}>
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
