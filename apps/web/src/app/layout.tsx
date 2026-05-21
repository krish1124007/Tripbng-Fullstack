import type { Metadata } from 'next';
import { Manrope, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { readBrandingCookie } from '@/lib/branding-cookie';
import { brandingStyleTag } from '@/components/branding/branding-theme-provider';
import '@/styles/globals.css';

// Manrope — friendly rounded sans, complements the wordmark. Weight does the work for hierarchy.
const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});
// JetBrains Mono — for IDs, PNRs, codes; tabular by default in our globals.css.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: { default: 'TripBng', template: '%s · TripBng' },
  description:
    'Enterprise B2B travel distribution — series fares, distributor cockpits, transparent ledgers.',
  // Next.js auto-generates the `<link rel="icon">` tags from the convention files
  // app/icon.png and app/apple-icon.png — no explicit `icons` field needed here.
  // OG images stay at the platform default; partner branding lives at /partner-logo.svg.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // SSR branding hydration — read the snapshot the API set in the
  // tripbng_branding cookie (on login + after every branding write).
  // When present, we inject a <style> tag in <head> with the four
  // tenant CSS variables so the very first paint already shows the
  // tenant theme. Without this, authenticated routes would briefly
  // flash the platform-default colours on every navigation.
  const branding = readBrandingCookie();
  const styleCss = brandingStyleTag(branding);

  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {styleCss ? (
          <style
            id="tripbng-branding-ssr"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: styleCss }}
          />
        ) : null}
      </head>
      <body>
        <Providers initialBranding={branding}>{children}</Providers>
      </body>
    </html>
  );
}
