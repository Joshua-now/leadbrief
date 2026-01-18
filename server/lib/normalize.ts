import crypto from 'crypto';

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
}

export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website || typeof website !== 'string') return null;
  
  let domain = website.trim().toLowerCase();
  
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.split('/')[0];
  domain = domain.split('?')[0];
  domain = domain.split('#')[0];
  domain = domain.replace(/:\d+$/, '');
  
  if (!domain || domain.length < 3 || !domain.includes('.')) return null;
  
  return domain;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;
  
  let digits = phone.replace(/\D/g, '');
  
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.substring(1);
  }
  
  if (digits.length < 7) return null;
  
  return digits;
}

export function normalizeCompany(company: string | null | undefined): string | null {
  if (!company || typeof company !== 'string') return null;
  return company.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function computeSourceHash(
  emailNorm: string | null,
  domainNorm: string | null,
  phoneNorm: string | null
): string {
  const key = [emailNorm || '', domainNorm || '', phoneNorm || ''].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
}

export interface NormalizedFields {
  emailNorm: string | null;
  domainNorm: string | null;
  phoneNorm: string | null;
  sourceHash: string;
}

export function normalizeContactFields(contact: {
  email?: string | null;
  website?: string | null;
  phone?: string | null;
}): NormalizedFields {
  const emailNorm = normalizeEmail(contact.email);
  const domainNorm = normalizeDomain(contact.website);
  const phoneNorm = normalizePhone(contact.phone);
  const sourceHash = computeSourceHash(emailNorm, domainNorm, phoneNorm);
  
  return { emailNorm, domainNorm, phoneNorm, sourceHash };
}
