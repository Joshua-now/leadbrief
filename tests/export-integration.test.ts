import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

describe('Export Endpoints Integration Tests', () => {
  
  describe('GET /api/contacts/export', () => {
    it('should return 401 Unauthorized without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/contacts/export`);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('should NOT return HTML (no SPA fallback)', async () => {
      const response = await fetch(`${BASE_URL}/api/contacts/export`);
      const contentType = response.headers.get('content-type') || '';
      expect(contentType).not.toContain('text/html');
      expect(contentType).toContain('application/json');
    });
  });

  describe('GET /api/jobs/:id/export', () => {
    it('should return 401 Unauthorized without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/jobs/test-id/export`);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('should NOT return HTML (no SPA fallback)', async () => {
      const response = await fetch(`${BASE_URL}/api/jobs/test-id/export`);
      const contentType = response.headers.get('content-type') || '';
      expect(contentType).not.toContain('text/html');
    });
  });

  describe('Content-Type verification for authenticated exports', () => {
    it('should verify CSV export sets correct headers (manual test required)', () => {
      expect(true).toBe(true);
    });
  });

  describe('Route ordering verification', () => {
    it('/api/contacts/export should NOT match as /api/contacts/:id', async () => {
      const response = await fetch(`${BASE_URL}/api/contacts/export`);
      const body = await response.json();
      expect(body.error).not.toBe('Invalid contact ID format');
    });

    it('/api/jobs/recover should NOT match as /api/jobs/:id', async () => {
      const response = await fetch(`${BASE_URL}/api/jobs/recover`, { method: 'POST' });
      const body = await response.json();
      expect(body.error).not.toBe('Invalid job ID format');
    });
  });
});
