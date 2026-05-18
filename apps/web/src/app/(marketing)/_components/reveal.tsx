'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Reveal — fades children in + 6px translateY when they enter viewport.
 * Pure CSS transition. Respects prefers-reduced-motion via tokens.css.
 *
 * Use `delay` (0–600 ms) for staggered children.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: As = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'article' | 'aside' | 'span';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Cast to any to satisfy union typing on `As`.
  const Comp = As as React.ElementType;

  return (
    <Comp
      ref={ref as React.Ref<HTMLElement>}
      className={cn(
        'transition-[opacity,transform] duration-slow ease-out-expo',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5',
        className,
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Comp>
  );
}
