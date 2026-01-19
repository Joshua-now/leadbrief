import { describe, it, expect } from 'vitest';
import { normalizeWebsiteUrl } from '../server/lib/normalize';

describe('normalizeWebsiteUrl', () => {
  it('should return null for null/undefined/empty input', () => {
    expect(normalizeWebsiteUrl(null)).toBeNull();
    expect(normalizeWebsiteUrl(undefined)).toBeNull();
    expect(normalizeWebsiteUrl('')).toBeNull();
    expect(normalizeWebsiteUrl('   ')).toBeNull();
  });

  it('should keep valid https:// URLs', () => {
    expect(normalizeWebsiteUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('https://www.example.com')).toBe('https://www.example.com');
    expect(normalizeWebsiteUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('should convert http:// to https://', () => {
    expect(normalizeWebsiteUrl('http://example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('http://www.example.com')).toBe('https://www.example.com');
  });

  it('should fix https// (missing colon) to https://', () => {
    expect(normalizeWebsiteUrl('https//example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('http//example.com')).toBe('https://example.com');
  });

  it('should fix double protocol https://https://', () => {
    expect(normalizeWebsiteUrl('https://https://example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('https://http://example.com')).toBe('https://example.com');
  });

  it('should fix mixed malformed protocol https://https//', () => {
    expect(normalizeWebsiteUrl('https://https//example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('https://https//precisioncomforthvac.com')).toBe('https://precisioncomforthvac.com');
  });

  it('should add https:// to bare domains', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('www.example.com')).toBe('https://www.example.com');
    expect(normalizeWebsiteUrl('subdomain.example.com')).toBe('https://subdomain.example.com');
  });

  it('should strip trailing slashes and punctuation', () => {
    expect(normalizeWebsiteUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('https://example.com///')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('example.com.')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('example.com,')).toBe('https://example.com');
  });

  it('should handle whitespace', () => {
    expect(normalizeWebsiteUrl('  https://example.com  ')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('  example.com  ')).toBe('https://example.com');
  });

  it('should preserve paths but strip trailing slashes', () => {
    expect(normalizeWebsiteUrl('https://example.com/about')).toBe('https://example.com/about');
    expect(normalizeWebsiteUrl('https://example.com/about/')).toBe('https://example.com/about');
    expect(normalizeWebsiteUrl('example.com/contact/us')).toBe('https://example.com/contact/us');
  });

  it('should return null for invalid URLs', () => {
    expect(normalizeWebsiteUrl('not a url')).toBeNull();
    // Note: URL class considers "https://just-text-without-dots" valid
    // Real validation for domain format would need additional logic
  });
});
