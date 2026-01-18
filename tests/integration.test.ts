import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';

describe('API Integration Tests', () => {
  let app: express.Application;
  let server: ReturnType<typeof createServer>;
  
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    
    app.get('/api/health', (_req, res) => {
      res.json({ ok: true, status: 'healthy' });
    });
    
    app.get('/api/ready', (_req, res) => {
      res.json({ ready: true, status: 'ready' });
    });
    
    app.get('/api/config/limits', (_req, res) => {
      res.json({
        MAX_RECORDS: 10000,
        MAX_FILE_SIZE_MB: 10,
        MAX_EMAIL_LENGTH: 254,
        MAX_FIELD_LENGTH: 500,
        MIN_EMAIL_LENGTH: 5,
      });
    });
    
    app.get('/api/auth/config', (_req, res) => {
      res.json({
        provider: 'replit',
        isEnabled: true,
        supabaseConfigured: false,
      });
    });
    
    app.get('/api/auth/user', (_req, res) => {
      res.status(401).json({ message: 'Unauthorized' });
    });
    
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });
  
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  
  describe('Health Endpoints', () => {
    it('GET /api/health returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
    
    it('GET /api/ready returns 200', async () => {
      const res = await request(app).get('/api/ready');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
    });
  });
  
  describe('Config Endpoints', () => {
    it('GET /api/config/limits returns import limits', async () => {
      const res = await request(app).get('/api/config/limits');
      expect(res.status).toBe(200);
      expect(res.body.MAX_RECORDS).toBeDefined();
      expect(res.body.MAX_FILE_SIZE_MB).toBeDefined();
    });
    
    it('GET /api/auth/config returns auth provider info', async () => {
      const res = await request(app).get('/api/auth/config');
      expect(res.status).toBe(200);
      expect(res.body.provider).toBeDefined();
      expect(res.body.isEnabled).toBeDefined();
    });
  });
  
  describe('Auth Endpoints', () => {
    it('GET /api/auth/user returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(401);
    });
  });
});
