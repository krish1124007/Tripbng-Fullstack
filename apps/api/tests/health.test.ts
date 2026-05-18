import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../src/routes/health.routes.js';

describe('health', () => {
  it('GET /health returns 200', async () => {
    const app = express();
    app.use(healthRouter);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });
});
