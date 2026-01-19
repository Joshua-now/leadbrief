import { describe, it, expect } from 'vitest';
import { 
  normalizeEmail, 
  normalizePhone, 
  normalizePhoneE164,
  normalizeWebsiteUrl, 
  normalizeCity,
  normalizeContact
} from '../server/lib/normalize';

describe('Email normalization', () => {
  it('converts to lowercase', () => {
    expect(normalizeEmail('John@ACME.COM')).toBe('john@acme.com');
    expect(normalizeEmail('JANE@Example.Org')).toBe('jane@example.org');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  test@email.com  ')).toBe('test@email.com');
  });

  it('returns null for invalid emails', () => {
    expect(normalizeEmail('')).toBe(null);
    expect(normalizeEmail('invalid')).toBe(null);
    expect(normalizeEmail(null)).toBe(null);
    expect(normalizeEmail(undefined)).toBe(null);
  });
});

describe('Phone normalization', () => {
  it('normalizePhone extracts digits only', () => {
    expect(normalizePhone('(212) 555-1234')).toBe('2125551234');
    expect(normalizePhone('212-555-1234')).toBe('2125551234');
    expect(normalizePhone('+1 (310) 555-9999')).toBe('3105559999');
    expect(normalizePhone('1-312-555-0000')).toBe('3125550000');
  });

  it('normalizePhoneE164 returns E.164 format', () => {
    expect(normalizePhoneE164('(212) 555-1234')).toBe('+12125551234');
    expect(normalizePhoneE164('212-555-1234')).toBe('+12125551234');
    expect(normalizePhoneE164('4155551111')).toBe('+14155551111');
    expect(normalizePhoneE164('+1 (310) 555-9999')).toBe('+13105559999');
  });

  it('returns null for too short phones', () => {
    expect(normalizePhone('123')).toBe(null);
    expect(normalizePhoneE164('123')).toBe(null);
  });
});

describe('Website normalization', () => {
  it('adds https:// prefix', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('www.example.com')).toBe('https://www.example.com');
  });

  it('converts http to https', () => {
    expect(normalizeWebsiteUrl('http://example.com')).toBe('https://example.com');
  });

  it('handles existing https', () => {
    expect(normalizeWebsiteUrl('https://example.com')).toBe('https://example.com');
  });

  it('fixes malformed protocols', () => {
    expect(normalizeWebsiteUrl('https//example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('https://https://example.com')).toBe('https://example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeWebsiteUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('example.com/')).toBe('https://example.com');
  });

  it('returns null for invalid URLs', () => {
    expect(normalizeWebsiteUrl('')).toBe(null);
    expect(normalizeWebsiteUrl(null)).toBe(null);
    expect(normalizeWebsiteUrl(undefined)).toBe(null);
  });
});

describe('City normalization', () => {
  it('converts to titlecase', () => {
    expect(normalizeCity('NEW YORK')).toBe('New York');
    expect(normalizeCity('new york')).toBe('New York');
    expect(normalizeCity('SAN FRANCISCO')).toBe('San Francisco');
    expect(normalizeCity('los angeles')).toBe('Los Angeles');
    expect(normalizeCity('CHICAGO')).toBe('Chicago');
  });

  it('trims whitespace', () => {
    expect(normalizeCity('  SAN FRANCISCO  ')).toBe('San Francisco');
    expect(normalizeCity('  new york  ')).toBe('New York');
  });

  it('returns null for empty input', () => {
    expect(normalizeCity('')).toBe(null);
    expect(normalizeCity(null)).toBe(null);
    expect(normalizeCity(undefined)).toBe(null);
  });
});

describe('normalizeContact - centralized function', () => {
  const messyInput = {
    email: 'John@ACME.COM',
    phone: '(212) 555-1234',
    website: 'www.acme.com',
    city: 'NEW YORK',
    company_name: '  ACME Corp  ',
  };

  it('normalizes all fields consistently', () => {
    const result = normalizeContact(messyInput);
    
    expect(result.email).toBe('john@acme.com');
    expect(result.phone).toBe('+12125551234');
    expect(result.phoneDigits).toBe('2125551234');
    expect(result.website).toBe('https://www.acme.com');
    expect(result.city).toBe('New York');
    expect(result.company_name).toBe('ACME Corp');
    expect(result.domain).toBe('acme.com');
    expect(result.sourceHash).toBeDefined();
    expect(result.sourceHash.length).toBe(16);
  });

  it('handles partial input', () => {
    const result = normalizeContact({
      email: 'test@example.com',
    });
    
    expect(result.email).toBe('test@example.com');
    expect(result.phone).toBe(null);
    expect(result.website).toBe(null);
    expect(result.city).toBe(null);
    expect(result.company_name).toBe(null);
  });

  it('handles null/undefined input', () => {
    const result = normalizeContact({
      email: null,
      phone: undefined,
      website: null,
      city: undefined,
      company_name: null,
    });
    
    expect(result.email).toBe(null);
    expect(result.phone).toBe(null);
    expect(result.website).toBe(null);
    expect(result.city).toBe(null);
    expect(result.company_name).toBe(null);
  });

  it('produces same result for same messy input (idempotent)', () => {
    const result1 = normalizeContact(messyInput);
    const result2 = normalizeContact(messyInput);
    
    expect(result1).toEqual(result2);
    expect(result1.sourceHash).toBe(result2.sourceHash);
  });

  it('produces consistent normalization across different input formats', () => {
    const variations = [
      { email: 'John@ACME.COM', phone: '(212) 555-1234', website: 'www.acme.com', city: 'NEW YORK' },
      { email: 'JOHN@acme.com', phone: '212-555-1234', website: 'https://www.acme.com', city: 'new york' },
      { email: '  john@acme.com  ', phone: '+1 212 555 1234', website: 'http://www.acme.com/', city: '  New York  ' },
    ];
    
    const results = variations.map(v => normalizeContact(v));
    
    expect(results[0].email).toBe(results[1].email);
    expect(results[1].email).toBe(results[2].email);
    
    expect(results[0].city).toBe(results[1].city);
    expect(results[1].city).toBe(results[2].city);
    
    expect(results[0].website).toBe(results[1].website);
    expect(results[1].website).toBe(results[2].website);
  });
});
