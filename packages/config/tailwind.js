// Shared Tailwind preset — apps extend this. Tokens map to CSS variables defined in
// apps/web/src/styles/tokens.css. Keep this file declarative; never put values here that
// aren't echoes of a token.
/** @type {import('tailwindcss').Config} */
export const tailwindPreset = {
  // Dark mode disabled — selector points to a class that's never applied, so
  // any stray `dark:` Tailwind variants stay inert and `prefers-color-scheme`
  // can't flip the UI either.
  darkMode: ['class', '[data-theme="__never__"]'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1440px',
      },
    },
    // Breakpoint roster — added `xs` at 480px to bridge the gap between
    // phone (375px iPhone 13 mini, 393px Pixel) and the default `sm:640`.
    // This is where "phone-but-roomy" UX lives — adds a layer for grid
    // bumps and chip flow tightening without firing the full sm: cascade.
    screens: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1440px',
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
        /**
         * Per-tenant branding tokens. `primary` and `secondary` are
         * NOT used by existing platform UI — they're the canvas the
         * tenant paints on. The CSS variables are populated by
         * `BrandingThemeProvider` from the resolved branding doc; if
         * no doc exists they stay at the TripBng platform defaults
         * baked into globals.css.
         *
         * Use these for:
         *   - The portal sidebar / topbar logo + primary CTAs the
         *     tenant should be able to customise
         *   - Document headers / PDF accents (mirrored as fields on
         *     ResolvedBranding for the pdfkit pipeline)
         *
         * Do NOT use these for system / status UI — keep `brand`,
         * `accent`, `success`, etc. for that.
         */
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          foreground: 'var(--color-primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
        },
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
        // 2xl — heroes / floating CTAs that need to feel like they're hovering
        // over the page, not sitting on it. Slightly tinted so the lift reads
        // as brand-aware instead of neutral grey.
        '2xl':
          '0 25px 50px -12px rgb(15 23 42 / 0.18), 0 12px 24px -10px rgb(30 64 175 / 0.10)',
        card: 'var(--shadow-sm)',
        elevated: 'var(--shadow-lg)',
        brand: 'var(--shadow-brand)',
        // Inset focus glow (subtle, no offset double-ring)
        'focus-ring': '0 0 0 3px var(--ring)',
      },
      transitionTimingFunction: {
        'out-expo': 'var(--ease-out-expo)',
        spring: 'var(--ease-spring)',
        // Snappy ease — the curve every modern UI defaults to (Material 3,
        // iOS spring). Use for state transitions where things should feel
        // present and responsive without bouncing.
        snappy: 'cubic-bezier(0.32, 0.72, 0, 1)',
        // Bounce — only for delightful moments (toast in, badge pulse). Do
        // NOT use for input feedback; it feels broken on rapid interactions.
        bounce: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '400ms',
        // Pulled-down extras for micro-interactions (button press, ripple).
        // Anything below 120ms feels instant; above 400ms feels sluggish.
        instant: '80ms',
        slower: '600ms',
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
  plugins: [
    // Tiny in-line plugin — exposes utilities that we kept inlining as
    // arbitrary values (`[scrollbar-width:none]` etc.). Centralising them
    // here cleans up call sites and lets us version the behaviour.
    ({ addUtilities }) => {
      addUtilities({
        // iOS notch / home-bar / dynamic-island handling. Use these on any
        // element pinned to the edge of the viewport (sheets, bottom nav,
        // sticky toolbars, top-bars on PWAs).
        '.pt-safe': { 'padding-top': 'env(safe-area-inset-top)' },
        '.pb-safe': { 'padding-bottom': 'env(safe-area-inset-bottom)' },
        '.pl-safe': { 'padding-left': 'env(safe-area-inset-left)' },
        '.pr-safe': { 'padding-right': 'env(safe-area-inset-right)' },
        '.px-safe': {
          'padding-left': 'env(safe-area-inset-left)',
          'padding-right': 'env(safe-area-inset-right)',
        },
        '.py-safe': {
          'padding-top': 'env(safe-area-inset-top)',
          'padding-bottom': 'env(safe-area-inset-bottom)',
        },
        // "Use my padding OR the safe-area, whichever is larger." Avoids
        // the double-margin bug when a designer sets `pb-4` but iOS adds
        // 34px on top of that for the home indicator.
        '.pb-safe-or-2': {
          'padding-bottom': 'max(0.5rem, env(safe-area-inset-bottom))',
        },
        '.pb-safe-or-3': {
          'padding-bottom': 'max(0.75rem, env(safe-area-inset-bottom))',
        },
        '.pb-safe-or-4': {
          'padding-bottom': 'max(1rem, env(safe-area-inset-bottom))',
        },

        // Hide the scrollbar but keep the element scrollable. Used in
        // chip rows, tab strips, fare strips — anywhere a native bar would
        // chew vertical space on a small screen.
        '.scrollbar-hide': {
          'scrollbar-width': 'none',
          '-ms-overflow-style': 'none',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
        },

        // Kill the blue tap highlight Mobile Safari adds to every tap on
        // interactive elements. Our own :active styles + active:scale[0.98]
        // already do the job and the system flash fights against them.
        '.tap-transparent': {
          '-webkit-tap-highlight-color': 'transparent',
        },

        // Hardware-accelerated rendering hint. Apply to elements that
        // will be animated (sticky elements during scroll, sliding sheets)
        // to avoid layout jank on lower-end Android.
        '.will-animate': {
          'will-change': 'transform, opacity',
          'transform': 'translateZ(0)',
        },
      });
    },
  ],
};

export default tailwindPreset;
