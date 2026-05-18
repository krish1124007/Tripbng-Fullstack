// PageHero — shared hero shell for /about, /careers, /contact, /press,
// /mobile, /help, /docs, /api, /status, and the legal pages.
//
// Visual recipe: aurora-tinted glow rail at the very top (just enough to
// echo the landing hero's brand without forcing every sub-page to wear a
// dark panel), eyebrow + big balanced headline, optional subhead, optional
// action row. Everything below is `bg-surface-1` so cards / prose / tables
// inherit the same canvas.

import type { ReactNode } from 'react';
import { Reveal } from './reveal';

interface PageHeroProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional element rendered to the right of the headline on lg+ —
   *  e.g. an illustration or stat block. */
  aside?: ReactNode;
}

export function PageHero({ eyebrow, title, subtitle, actions, aside }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden bg-surface-0 pb-12 pt-28 lg:pb-20 lg:pt-32">
      {/* Soft accent orbs — same motion vocabulary as the landing hero
          but turned down to 10–20% opacity so the panel stays light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-300/25 blur-3xl animate-float-orb"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-10 h-[24rem] w-[24rem] rounded-full bg-accent-300/20 blur-3xl animate-float-orb-slow"
      />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className={aside ? 'grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]' : 'max-w-3xl'}>
          <div>
            {eyebrow ? (
              <Reveal>
                <p className="eyebrow text-brand-600">{eyebrow}</p>
              </Reveal>
            ) : null}
            <Reveal delay={60}>
              <h1 className="mt-2 text-display-2 font-bold leading-[1.05] tracking-tight text-balance text-ink-1 lg:text-[60px]">
                {title}
              </h1>
            </Reveal>
            {subtitle ? (
              <Reveal delay={140}>
                <div className="mt-5 max-w-2xl text-base leading-relaxed text-ink-3 lg:text-lg">
                  {subtitle}
                </div>
              </Reveal>
            ) : null}
            {actions ? (
              <Reveal delay={220} className="mt-7 flex flex-wrap items-center gap-3">
                {actions}
              </Reveal>
            ) : null}
          </div>
          {aside ? (
            <Reveal delay={180} className="lg:justify-self-end">
              {aside}
            </Reveal>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ProsePage — wrapper for legal pages (Terms, Privacy, DPDP, Refund).
// Renders a stable narrow column with consistent typography. Section
// titles use h2/h3 styles via the .prose-doc utility (defined inline).
// ─────────────────────────────────────────────────────────────────────

interface ProsePageProps {
  eyebrow?: string;
  title: string;
  lastUpdated?: string;
  toc?: { id: string; label: string }[];
  children: ReactNode;
}

export function ProsePage({ eyebrow, title, lastUpdated, toc, children }: ProsePageProps) {
  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={title}
        subtitle={
          lastUpdated ? (
            <span className="font-mono text-sm text-ink-3">Last updated · {lastUpdated}</span>
          ) : undefined
        }
      />
      <section className="bg-surface-1 pb-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[18rem_1fr] lg:px-8">
          {toc && toc.length > 0 ? (
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <p className="eyebrow mb-3 text-ink-3">On this page</p>
              <ul className="space-y-1.5 border-l border-strong/40">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="-ml-px block border-l-2 border-transparent pl-3 py-1 text-sm text-ink-2 transition-colors hover:border-brand-400 hover:text-brand-700"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
          <article
            className={[
              'max-w-3xl',
              'text-[15px] leading-[1.75] text-ink-2',
              '[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-ink-1',
              '[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink-1',
              '[&_p]:mt-4',
              '[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6',
              '[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6',
              '[&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline-offset-4 hover:[&_a]:underline',
              '[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]',
              '[&_blockquote]:mt-5 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-ink-3',
            ].join(' ')}
          >
            {children}
          </article>
        </div>
      </section>
    </>
  );
}
