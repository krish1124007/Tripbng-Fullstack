// Flat config — applies to all workspaces. Per-package configs extend this.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.{js,cjs,mjs,ts}',
      // k6 load-test scripts run under k6's runtime (not Node) and use k6 globals
      // like __ENV and __VU. Don't lint them with the regular project config.
      'infra/loadtest/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // Branding-resolution guard — every document/email render site
    // MUST pass a resolved branding so per-tenant logo + colours
    // appear. Calling `renderFlightInvoicePdf(inv)` (no branding arg)
    // would silently render the platform-default chrome and lose the
    // agent's identity on the document. Use the second arg (branding
    // can be `null` explicitly — that's how internal alerts opt out).
    //
    // Scoped to the API services + routes; smoke scripts under
    // src/scripts are exempted via the override below so dev tooling
    // can render dummy PDFs without going through the resolver.
    files: ['apps/api/src/services/**/*.ts', 'apps/api/src/routes/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^(renderFlightInvoicePdf|renderBusInvoicePdf|generateInvoicePdf|generateHotelInvoicePdf|generateHolidayInvoicePdf|generateVisaInvoicePdf|generateETicketPdf)$/][arguments.length<2]",
          message:
            'PDF render must receive a resolved branding as the second argument. Call BrandedDocumentService.resolveForBooking(bookingId) or resolveForAgencyOrDistributor(...) first, then pass the result. Pass `null` explicitly only for internal/system documents.',
        },
        {
          // E-ticket variant — takes an options object whose `branding`
          // key must be set (a non-existent key still silently no-ops).
          selector:
            "CallExpression[callee.name='generateETicketPdf'] > ObjectExpression:nth-child(2):not(:has(Property[key.name='branding']))",
          message:
            'generateETicketPdf({...}) options must include `branding` (set to a ResolvedBranding or null). Skip the rule with an explicit eslint-disable-next-line if the call site genuinely cannot resolve branding.',
        },
      ],
    },
  },
  {
    // Smoke scripts intentionally exercise renderers without branding.
    files: ['apps/api/src/scripts/**/*.ts', 'apps/api/tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
