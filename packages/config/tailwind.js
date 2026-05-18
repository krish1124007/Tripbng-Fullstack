// Shared Tailwind preset — apps extend this. Tokens map to CSS variables defined in
// apps/web/src/styles/tokens.css. Keep this file declarative; never put values here that
// aren't echoes of a token.
/** @type {import('tailwindcss').Config} */
export const tailwindPreset = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1440px',
      },
    },
    extend: {
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          glass: 'var(--surface-glass)',
        },
        ink: {
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
          5: 'var(--ink-5)',
        },
        brand: {
          DEFAULT: 'var(--brand-500)',
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
          300: 'var(--brand-300)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
          900: 'var(--brand-900)',
          deep: 'var(--brand-deep)',
          mid: 'var(--brand-mid)',
        },
        accent: {
          DEFAULT: 'var(--accent-500)',
          50: 'var(--accent-50)',
          100: 'var(--accent-100)',
          200: 'var(--accent-200)',
          300: 'var(--accent-300)',
          400: 'var(--accent-400)',
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
          700: 'var(--accent-700)',
          800: 'var(--accent-800)',
          900: 'var(--accent-900)',
          soft: 'var(--accent-soft)',
        },
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
        },
        info: {
          DEFAULT: 'var(--info)',
          soft: 'var(--info-soft)',
        },
        border: {
          DEFAULT: 'var(--border-1)',
          strong: 'var(--border-2)',
        },
        ring: 'var(--ring)',
      },
      borderColor: {
        DEFAULT: 'var(--border-1)',
        strong: 'var(--border-2)',
      },
      ringColor: {
        DEFAULT: 'var(--ring)',
      },
      fontFamily: {
        // Brand identity is the rounded sans wordmark. Keep one family; weight does the work.
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Tightened type scale for 16/14/13 base. Display sizes use display-tracking + tabular nums.
        'display-1': [
          '3.5rem',
          { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' },
        ],
        'display-2': [
          '2.5rem',
          { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '700' },
        ],
        h1: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        h2: ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '700' }],
        h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        h4: ['1.0625rem', { lineHeight: '1.4', fontWeight: '600' }],
        eyebrow: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '8px',
        md: '10px',
        lg: '14px',
        xl: '20px',
        '2xl': '24px',
        full: '9999px',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        card: 'var(--shadow-sm)',
        elevated: 'var(--shadow-lg)',
        brand: 'var(--shadow-brand)',
        // Inset focus glow (subtle, no offset double-ring)
        'focus-ring': '0 0 0 3px var(--ring)',
      },
      transitionTimingFunction: {
        'out-expo': 'var(--ease-out-expo)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '400ms',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(0.85)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 250ms var(--ease-out-expo)',
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 200ms var(--ease-out-expo)',
        'slide-down': 'slide-down 250ms var(--ease-out-expo)',
        'slide-in-right': 'slide-in-right 280ms var(--ease-out-expo)',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
      backgroundImage: {
        'brand-mesh':
          'radial-gradient(at 20% 30%, var(--brand-600) 0px, transparent 50%), radial-gradient(at 80% 0%, var(--brand-500) 0px, transparent 50%), radial-gradient(at 0% 90%, var(--accent-500) 0px, transparent 40%), radial-gradient(at 100% 100%, var(--brand-700) 0px, transparent 50%)',
        shimmer: 'linear-gradient(90deg, transparent 0%, var(--surface-2) 50%, transparent 100%)',
      },
    },
  },
  plugins: [],
};

export default tailwindPreset;
