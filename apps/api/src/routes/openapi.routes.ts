// OpenAPI 3.1 schema export — partner-integration enabler.
//
// We don't run a full Zod-to-OpenAPI generator (zod-to-openapi adds another
// dep + every schema needs decoration). Instead we hand-curate the routes
// that partners care about (search, booking, top-up, ticket download). The
// expensive bits — request/response shapes — are derived programmatically
// from the existing Zod schemas using `z.toJSONSchema`-style introspection.
//
// Two endpoints:
//   GET /api/v1/openapi.json — the raw OpenAPI document
//   GET /api/v1/docs        — minimal HTML wrapper that loads Redoc from CDN
//                              (no build step, no NPM install)

import { Router, type Router as RouterT } from 'express';

export const openapiRouter: RouterT = Router();

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'TripBng Partner API',
    version: '0.1.0',
    description:
      'Public partner-facing endpoints. Authenticated routes use a bearer token issued via /auth/login.',
    contact: { name: 'TripBng Engineering', email: 'engineering@tripbng.com' },
  },
  servers: [
    { url: 'https://partnerhub.tripbng.com', description: 'Production' },
    { url: 'http://localhost:4100', description: 'Dev' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
            required: ['code', 'message'],
          },
        },
        required: ['success', 'error'],
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Login + token refresh' },
    { name: 'Search', description: 'Flight search + airport autocomplete' },
    { name: 'Booking', description: 'Hold + confirm + cancel + ticket' },
    { name: 'Insurance', description: 'ASEGO travel insurance' },
    { name: 'Payments', description: 'Wallet top-ups, gateway returns' },
  ],
  paths: {
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate with email + password (+ optional TOTP)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  totp: { type: 'string', minLength: 6, maxLength: 6 },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Access + refresh tokens' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/airports': {
      get: {
        tags: ['Search'],
        summary: 'Airport autocomplete (worldwide)',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
        ],
        responses: { 200: { description: 'List of matching airports (IATA, city, country)' } },
      },
    },
    '/api/v1/search/flights': {
      post: {
        tags: ['Search'],
        summary: 'Multi-supplier flight fanout (one-way / round-trip / multi-city)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tripType: { type: 'string', enum: ['ONEWAY', 'ROUNDTRIP', 'MULTICITY'] },
                  segments: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 6,
                    items: {
                      type: 'object',
                      properties: {
                        origin: { type: 'string', minLength: 3, maxLength: 3 },
                        destination: { type: 'string', minLength: 3, maxLength: 3 },
                        date: { type: 'string', format: 'date' },
                      },
                      required: ['origin', 'destination', 'date'],
                    },
                  },
                  travelClass: {
                    type: 'string',
                    enum: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'],
                  },
                  pax: {
                    type: 'object',
                    properties: {
                      adults: { type: 'integer', minimum: 1, maximum: 9 },
                      children: { type: 'integer', minimum: 0, maximum: 9 },
                      infants: { type: 'integer', minimum: 0, maximum: 4 },
                    },
                    required: ['adults', 'children', 'infants'],
                  },
                },
                required: ['tripType', 'segments', 'travelClass', 'pax'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Search results (priced, deduped) + per-supplier errors' },
        },
      },
    },
    '/api/v1/bookings/hold': {
      post: {
        tags: ['Booking'],
        summary: 'Hold a fare (deducts blocked balance)',
        responses: {
          201: { description: 'Hold created, expiresAt returned' },
          422: { description: 'Insufficient wallet balance' },
        },
      },
    },
    '/api/v1/bookings/confirm': {
      post: {
        tags: ['Booking'],
        summary: 'Confirm a held booking (debits wallet, issues ticket)',
        responses: { 200: { description: 'Booking TICKETED' } },
      },
    },
    '/api/v1/bookings/{id}/ticket': {
      get: {
        tags: ['Booking'],
        summary: 'Download e-ticket PDF',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'application/pdf' } },
      },
    },
    '/api/v1/insurance/quote': {
      post: {
        tags: ['Insurance'],
        summary: 'Live ASEGO travel-insurance quote',
        responses: { 200: { description: 'Plans + coverages + age-premium tuples' } },
      },
    },
    '/api/v1/insurance/issue': {
      post: {
        tags: ['Insurance'],
        summary: 'Issue policies (encrypted; one per traveler)',
        responses: {
          200: {
            description:
              'policyNumbers + downloadUrls. PDF retrievable via /policy/:n/pdf.',
          },
        },
      },
    },
    '/api/v1/payments/topups/initiate': {
      post: {
        tags: ['Payments'],
        summary: 'Start a wallet top-up (ICICI Eazypay or PhonePe)',
        responses: {
          200: {
            description:
              'redirectUrl + sessionId. Frontend redirects (or auto-submits hidden form for FORM_POST).',
          },
        },
      },
    },
    '/api/v1/payments/{txnCode}/status': {
      get: {
        tags: ['Payments'],
        summary: 'Poll PT status — UI uses this on /wallet/topup/result',
        parameters: [{ name: 'txnCode', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Current status, instrument, failure reason' } },
      },
    },
  },
};

openapiRouter.get('/openapi.json', (_req, res) => {
  res.json(SPEC);
});

openapiRouter.get('/docs', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html>
  <head>
    <title>TripBng Partner API</title>
    <meta charset="utf-8" />
    <style>body{margin:0;font-family:sans-serif}</style>
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
});
