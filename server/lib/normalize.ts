import crypto from 'crypto';

/**
 * Normalize website URL to a clean https:// format
 * Rules:
 * - If starts with http:// or https:// keep it (convert http to https)
 * - If starts with https// (missing colon) fix to https://
 * - If domain-only (example.com / www.example.com) prepend https://
 * - Strip whitespace, trailing slashes, and punctuation
 * - Returns null for invalid/empty input
 */
export function normalizeWebsiteUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  
  let cleaned = url.trim();
  if (!cleaned) return null;
  
  // Fix common malformed protocols
  // Handle "https//" -> "https://" (missing colon)
  cleaned = cleaned.replace(/^https\/\//i, 'https://');
  // Handle "http//" -> "http://" (missing colon)  
  cleaned = cleaned.replace(/^http\/\//i, 'http://');
  // Handle double protocol "https://https://" or "https://http://"
  cleaned = cleaned.replace(/^https?:\/\/https?:\/\//i, 'https://');
  // Handle "https://https//" (mixed malformed)
  cleaned = cleaned.replace(/^https?:\/\/https\/\//i, 'https://');
  
  // If no protocol, add https://
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  
  // Convert http to https
  if (cleaned.startsWith('http://')) {
    cleaned = cleaned.replace('http://', 'https://');
  }
  
  // Strip trailing slashes and punctuation
  cleaned = cleaned.replace(/[\/\s.,;:!?]+$/, '');
  
  // Validate URL format
  try {
    const parsed = new URL(cleaned);
    // Return normalized URL (without trailing slash)
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    // If URL parsing fails, return null
    return null;
  }
}

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

export function normalizeCity(city: string | null | undefined): string | null {
  if (!city || typeof city !== 'string') return null;
  const trimmed = city.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  // Titlecase: capitalize first letter of each word
  return trimmed
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function normalizePhoneE164(phone: string | null | undefined, defaultCountry = '1'): string | null {
  if (!phone || typeof phone !== 'string') return null;
  
  let digits = phone.replace(/\D/g, '');
  
  // Handle US numbers
  if (digits.length === 10) {
    digits = defaultCountry + digits; // Add US country code
  } else if (digits.length === 11 && digits.startsWith('1')) {
    // Already has US country code
  } else if (digits.length < 10) {
    return null; // Too short
  }
  
  return '+' + digits;
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

/**
 * Canonical contact normalization - single source of truth for all paths:
 * import parsing, merge/dedup, and export
 * 
 * Returns normalized versions of all canonical fields:
 * - email: lowercase
 * - phone: E.164 format (+1XXXXXXXXXX) or digits-only
 * - phoneDigits: digits only (for dedup matching)
 * - website: https:// with no double protocol
 * - city: titlecase
 * - company_name: preserved (no case change, just trimmed)
 * - domain: extracted from website for matching
 */
export interface NormalizedContact {
  email: string | null;
  phone: string | null;       // E.164 format preferred
  phoneDigits: string | null; // Digits only for matching
  website: string | null;     // https:// normalized
  city: string | null;        // Titlecase
  company_name: string | null; // Trimmed, original case
  domain: string | null;      // Extracted for matching
  sourceHash: string;
}

export function normalizeContact(contact: {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  company_name?: string | null;
}): NormalizedContact {
  const email = normalizeEmail(contact.email);
  const phoneE164 = normalizePhoneE164(contact.phone);
  const phoneDigits = normalizePhone(contact.phone);
  const website = normalizeWebsiteUrl(contact.website);
  const city = normalizeCity(contact.city);
  const company_name = contact.company_name?.trim() || null;
  const domain = normalizeDomain(contact.website);
  const sourceHash = computeSourceHash(email, domain, phoneDigits);
  
  return {
    email,
    phone: phoneE164,
    phoneDigits,
    website,
    city,
    company_name,
    domain,
    sourceHash,
  };
}
