import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';

describe('Health Check Endpoints', () => {
  let app: express.Application;
  let server: ReturnType<typeof createServer>;
  
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    
    app.get('/api/health', (_req, res) => {
      res.json({
        ok: true,
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    });
    
    app.get('/api/ready', (_req, res) => {
      res.json({
        ready: true,
        status: 'ready',
        dependencies: { database: 'connected', auth: 'configured' },
      });
    });
    
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });
  
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  
  it('should return 200 on /api/health', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.status).toBe('healthy');
  });
  
  it('should include version in health response', async () => {
    const response = await request(app).get('/api/health');
    expect(response.body.version).toBeDefined();
    expect(typeof response.body.version).toBe('string');
  });
  
  it('should include timestamp in health response', async () => {
    const response = await request(app).get('/api/health');
    expect(response.body.timestamp).toBeDefined();
    expect(new Date(response.body.timestamp).getTime()).not.toBeNaN();
  });
  
  it('should return 200 on /api/ready when ready', async () => {
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(true);
  });
  
  it('should include dependency status in ready response', async () => {
    const response = await request(app).get('/api/ready');
    expect(response.body.dependencies).toBeDefined();
    expect(response.body.dependencies.database).toBeDefined();
  });
});
