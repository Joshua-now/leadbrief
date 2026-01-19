import { describe, it, expect } from 'vitest';

type ExportRecord = {
  company_name: string | null;
  website: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  personalization_bullets: string[];
  confidence_score: number;
};

function deduplicateRecords(rawRecords: ExportRecord[]): ExportRecord[] {
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const seenCompanyCities = new Set<string>();
  
  return rawRecords.filter(record => {
    const phoneNorm = typeof record.phone === 'string' ? record.phone.replace(/\D/g, '') : null;
    const hasPhone = phoneNorm && phoneNorm.length >= 7;
    const emailNorm = typeof record.email === 'string' ? record.email.toLowerCase() : null;
    const companyNorm = typeof record.company_name === 'string' ? record.company_name.toLowerCase().trim() : null;
    const cityNorm = typeof record.city === 'string' ? record.city.toLowerCase().trim() : null;
    const companyCityKey = (companyNorm && cityNorm) ? `${companyNorm}|${cityNorm}` : null;
    
    let isDuplicate = false;
    if (hasPhone && seenPhones.has(phoneNorm)) isDuplicate = true;
    if (emailNorm && seenEmails.has(emailNorm)) isDuplicate = true;
    if (companyCityKey && seenCompanyCities.has(companyCityKey)) isDuplicate = true;
    
    if (isDuplicate) return false;
    
    if (hasPhone) seenPhones.add(phoneNorm);
    if (emailNorm) seenEmails.add(emailNorm);
    if (companyCityKey) seenCompanyCities.add(companyCityKey);
    return true;
  });
}

describe('Export Deduplication', () => {
  const makeRecord = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
    company_name: null,
    website: null,
    city: null,
    email: null,
    phone: null,
    personalization_bullets: [],
    confidence_score: 0,
    ...overrides,
  });

  it('should keep first record when phone+email blocks later phone-only duplicate', () => {
    const records = [
      makeRecord({ phone: '555-123-4567', email: 'test@example.com', company_name: 'First Co' }),
      makeRecord({ phone: '555-123-4567', company_name: 'Second Co' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe('First Co');
  });

  it('should keep first record when phone+email blocks later email-only duplicate', () => {
    const records = [
      makeRecord({ phone: '555-123-4567', email: 'test@example.com', company_name: 'First Co' }),
      makeRecord({ email: 'test@example.com', company_name: 'Second Co' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe('First Co');
  });

  it('should remove company+city duplicates when identifiers claimed', () => {
    const records = [
      makeRecord({ company_name: 'Acme Corp', city: 'Chicago', email: 'first@acme.com' }),
      makeRecord({ company_name: 'Acme Corp', city: 'Chicago', email: 'second@acme.com' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('first@acme.com');
  });

  it('should keep records with different company+city combinations', () => {
    const records = [
      makeRecord({ company_name: 'Acme Corp', city: 'Chicago' }),
      makeRecord({ company_name: 'Acme Corp', city: 'New York' }),
      makeRecord({ company_name: 'Beta Inc', city: 'Chicago' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(3);
  });

  it('should handle phone normalization (remove non-digits)', () => {
    const records = [
      makeRecord({ phone: '(555) 123-4567', company_name: 'First' }),
      makeRecord({ phone: '555.123.4567', company_name: 'Second' }),
      makeRecord({ phone: '5551234567', company_name: 'Third' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe('First');
  });

  it('should handle email case normalization', () => {
    const records = [
      makeRecord({ email: 'Test@Example.COM', company_name: 'First' }),
      makeRecord({ email: 'test@example.com', company_name: 'Second' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe('First');
  });

  it('should keep records with no valid identifiers (no deduplication possible)', () => {
    const records = [
      makeRecord({ website: 'https://example1.com' }),
      makeRecord({ website: 'https://example2.com' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(2);
  });

  it('should handle mixed identifier scenarios correctly', () => {
    const records = [
      makeRecord({ phone: '555-111-2222', email: 'a@test.com', company_name: 'Company A', city: 'NYC' }),
      makeRecord({ phone: '555-333-4444', email: 'a@test.com', company_name: 'Company B', city: 'LA' }),
      makeRecord({ company_name: 'Company A', city: 'NYC', email: 'different@test.com' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe('Company A');
    expect(result[0].phone).toBe('555-111-2222');
  });

  it('should require minimum 7 digits for phone matching', () => {
    const records = [
      makeRecord({ phone: '123456', company_name: 'First' }),
      makeRecord({ phone: '123456', company_name: 'Second' }),
    ];
    
    const result = deduplicateRecords(records);
    
    expect(result).toHaveLength(2);
  });
});
