import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Environment Validation', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  it('should detect Replit environment when REPL_ID is set', async () => {
    process.env.REPL_ID = 'test-repl-id';
    const { isReplit } = await import('../server/lib/env');
    expect(isReplit()).toBe(true);
  });
  
  it('should detect non-Replit environment when REPL_ID is not set', async () => {
    delete process.env.REPL_ID;
    const { isReplit } = await import('../server/lib/env');
    expect(isReplit()).toBe(false);
  });
  
  it('should validate environment and return missing vars', async () => {
    delete process.env.REPL_ID;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    
    const { validateEnvironment } = await import('../server/lib/env');
    const result = validateEnvironment();
    
    expect(result.isValid).toBe(false);
    expect(result.missing).toContain('SESSION_SECRET');
  });
  
  it('should pass validation when all required vars are set on Replit', async () => {
    process.env.REPL_ID = 'test-repl-id';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.SESSION_SECRET = 'test-session-secret';
    
    const { validateEnvironment } = await import('../server/lib/env');
    const result = validateEnvironment();
    
    expect(result.isValid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
  
  it('should redact secret values in presence flags', async () => {
    process.env.DATABASE_URL = 'postgresql://user:password@host:5432/db';
    
    const { validateEnvironment } = await import('../server/lib/env');
    const result = validateEnvironment();
    
    expect(result.present['DATABASE_URL']).toMatch(/^present\(\.\.\..{4}\)$/);
    expect(result.present['DATABASE_URL']).not.toContain('password');
  });
  
  it('should get app version', async () => {
    const { getAppVersion } = await import('../server/lib/env');
    const version = getAppVersion();
    expect(version).toBeDefined();
    expect(typeof version).toBe('string');
  });
});
