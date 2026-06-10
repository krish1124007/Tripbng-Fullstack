'use client';

import { useRef, ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface ScrollSectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
  parallax?: boolean;
}

export function ScrollSection({ children, className = '', id, parallax = false }: ScrollSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });

  // Crazy animation transforms
  const y = useTransform(scrollYProgress, [0, 1], ["20%", "-20%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.8, 1, 1, 0.9]);
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [20, 0, -20]);

  return (
    <motion.section
      id={id}
      ref={ref}
      style={parallax ? { y, opacity, scale, rotateX } : { opacity, scale }}
      className={`relative will-change-transform ${className}`}
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {children}
    </motion.section>
  );
}
