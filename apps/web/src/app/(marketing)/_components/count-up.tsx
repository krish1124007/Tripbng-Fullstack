'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  to: number;
  /** Render override — useful for currency / commas / suffixes. */
  format?: (n: number) => string;
  /** Animation duration in ms. */
  duration?: number;
  /** Suffix appended after the formatted number (e.g. "+", "%", " Cr"). */
  suffix?: string;
  /** Prefix prepended (e.g. "₹"). */
  prefix?: string;
  className?: string;
}

/**
 * CountUp — animates 0 → `to` once the element scrolls into view.
 * Uses requestAnimationFrame with an ease-out cubic. No external deps.
 */
export function CountUp({
  to,
  format = (n) => Math.round(n).toLocaleString('en-IN'),
  duration = 1400,
  suffix = '',
  prefix = '',
  className,
}: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !started) {
          setStarted(true);
          obs.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(eased * to);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {format(value)}
      {suffix}
    </span>
  );
}
