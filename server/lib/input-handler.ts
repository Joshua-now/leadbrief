import { z } from 'zod';
import Papa from 'papaparse';
import { normalizePhone as normPhone, normalizeCompany as normCompany, normalizeCity, normalizePhoneE164, normalizeWebsiteUrl, normalizeEmail as normEmail } from './normalize';

// Helper to merge two contact records, keeping non-empty values
function mergeContacts(existing: ParsedContact, incoming: Partial<ParsedContact>): ParsedContact {
  const merged = { ...existing };
  for (const key of Object.keys(incoming) as (keyof ParsedContact)[]) {
    const incomingVal = incoming[key];
    const existingVal = existing[key];
    // Fill missing values from incoming
    if ((!existingVal || existingVal === '') && incomingVal && incomingVal !== '') {
      (merged as any)[key] = incomingVal;
    }
  }
  return merged;
}

// Constants for guard rails
export const IMPORT_LIMITS = {
  MAX_RECORDS: 10000,
  MAX_FILE_SIZE_MB: 10,
  MAX_EMAIL_LENGTH: 254,
  MAX_FIELD_LENGTH: 500,
  MIN_EMAIL_LENGTH: 5,
} as const;

// Enhanced email validation
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const ContactSchema = z.object({
  firstName: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
  lastName: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
  email: z.string()
    .min(IMPORT_LIMITS.MIN_EMAIL_LENGTH)
    .max(IMPORT_LIMITS.MAX_EMAIL_LENGTH)
    .toLowerCase()
    .refine((email) => emailRegex.test(email), { message: 'Invalid email format' })
    .optional(),
  phone: z.string().max(50).optional(),
  title: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional(),
  company: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional(),
  companyDomain: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional(),
  websiteUrl: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
  linkedinUrl: z.string().max(500).url().optional().or(z.literal('')),
  city: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
  state: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
  address: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
  category: z.string().max(IMPORT_LIMITS.MAX_FIELD_LENGTH).optional().or(z.literal('')),
}).refine(
  (data) => data.email || data.phone || data.linkedinUrl || data.websiteUrl || (data.company && data.city),
  'Requires email, phone, LinkedIn URL, website, or company+city'
);

export type ParsedContact = z.infer<typeof ContactSchema>;

export interface ImportResult {
  records: ParsedContact[];
  errors: Array<{
    rowNumber: number;
    field: string;
    message: string;
  }>;
  stats: {
    total: number;
    valid: number;
    invalid: number;
    errorRate: number;
  };
  warnings: string[];
}

// Sanitize input to prevent injection and fix common issues
function sanitizeString(value: string | undefined | null): string {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, IMPORT_LIMITS.MAX_FIELD_LENGTH);
}

// Normalize and validate email
function normalizeEmail(email: string | undefined | null): string | undefined {
  if (!email || typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  if (normalized.length < IMPORT_LIMITS.MIN_EMAIL_LENGTH) return undefined;
  if (normalized.length > IMPORT_LIMITS.MAX_EMAIL_LENGTH) return undefined;
  if (!emailRegex.test(normalized)) return undefined;
  return normalized;
}

// Normalize phone number
function normalizePhone(phone: string | undefined | null): string | undefined {
  if (!phone || typeof phone !== 'string') return undefined;
  // Remove common formatting, keep only digits and + for international
  const normalized = phone.replace(/[^\d+]/g, '');
  if (normalized.length < 7 || normalized.length > 20) return undefined;
  return normalized;
}

export class BulkInputHandler {
  static parseCSV(csvContent: string): ImportResult {
    const records: ParsedContact[] = [];
    const errors: ImportResult['errors'] = [];
    const warnings: string[] = [];
    const invalidRows = new Set<number>();
    
    // Track seen identifiers with indexes for merge-based dedup
    const emailToIndex = new Map<string, number>();
    const phoneToIndex = new Map<string, number>();
    const companyCityToIndex = new Map<string, number>();

    // Guard rail: Check content size
    const sizeInMB = Buffer.byteLength(csvContent, 'utf8') / (1024 * 1024);
    if (sizeInMB > IMPORT_LIMITS.MAX_FILE_SIZE_MB) {
      return {
        records: [],
        errors: [{ rowNumber: 0, field: 'file', message: `File exceeds ${IMPORT_LIMITS.MAX_FILE_SIZE_MB}MB limit` }],
        stats: { total: 0, valid: 0, invalid: 1, errorRate: 100 },
        warnings: [],
      };
    }

    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h: string) => h.trim().toLowerCase().replace(/[^\w]/g, '_'),
    });

    if (parsed.errors.length > 0) {
      return {
        records: [],
        errors: parsed.errors.map((e, idx) => ({
          rowNumber: e.row ?? idx,
          field: 'csv',
          message: e.message,
        })),
        stats: { total: 0, valid: 0, invalid: parsed.errors.length, errorRate: 100 },
        warnings: [],
      };
    }

    const data = parsed.data as Record<string, string>[];

    // Guard rail: Check record count
    if (data.length > IMPORT_LIMITS.MAX_RECORDS) {
      warnings.push(`File contains ${data.length} records. Only first ${IMPORT_LIMITS.MAX_RECORDS} will be processed.`);
    }

    const recordsToProcess = data.slice(0, IMPORT_LIMITS.MAX_RECORDS);

    recordsToProcess.forEach((row, idx) => {
      const rowNum = idx + 2;
      const mapped = this.mapRow(row);
      
      // Self-healing: Normalize canonical fields
      if (mapped.email) {
        mapped.email = normalizeEmail(mapped.email);
      }
      if (mapped.phone) {
        const e164 = normalizePhoneE164(mapped.phone);
        mapped.phone = e164 || normalizePhone(mapped.phone);
      }
      if (mapped.websiteUrl) {
        const normalizedUrl = normalizeWebsiteUrl(mapped.websiteUrl);
        mapped.websiteUrl = normalizedUrl || undefined;
      }
      if (mapped.city) {
        const normalizedCity = normalizeCity(mapped.city);
        mapped.city = normalizedCity || undefined;
      }
      
      // Deduplicate with NO-LOSS MERGE: phone_norm > email > company+city
      const phoneNorm = mapped.phone ? normPhone(mapped.phone) : null;
      const companyNorm = mapped.company ? normCompany(mapped.company) : null;
      const cityNorm = mapped.city ? mapped.city.toLowerCase().trim() : null;
      const companyCityKey = companyNorm && cityNorm ? `${companyNorm}|${cityNorm}` : null;
      
      // Check if this is a duplicate and find the index of the existing record to merge
      let existingIndex: number | undefined;
      let mergeReason: string | undefined;
      
      if (mapped.email && emailToIndex.has(mapped.email)) {
        existingIndex = emailToIndex.get(mapped.email);
        mergeReason = `email "${mapped.email}"`;
      } else if (phoneNorm && phoneToIndex.has(phoneNorm)) {
        existingIndex = phoneToIndex.get(phoneNorm);
        mergeReason = `phone "${mapped.phone}"`;
      } else if (companyCityKey && companyCityToIndex.has(companyCityKey)) {
        existingIndex = companyCityToIndex.get(companyCityKey);
        mergeReason = `company+city "${mapped.company}, ${mapped.city}"`;
      }
      
      // If duplicate found, merge into existing record instead of skipping
      if (existingIndex !== undefined && existingIndex < records.length) {
        const existingRecord = records[existingIndex];
        const merged = mergeContacts(existingRecord, mapped);
        records[existingIndex] = merged;
        warnings.push(`Row ${rowNum}: Duplicate by ${mergeReason} - merged`);
        return;
      }
      
      const result = ContactSchema.safeParse(mapped);

      if (result.success) {
        const recordIndex = records.length;
        records.push(result.data);
        
        // Track all identifiers for this record for future merges
        if (result.data.email) {
          emailToIndex.set(result.data.email, recordIndex);
        }
        if (phoneNorm) {
          phoneToIndex.set(phoneNorm, recordIndex);
        }
        if (companyCityKey) {
          companyCityToIndex.set(companyCityKey, recordIndex);
        }
      } else {
        invalidRows.add(rowNum);
        result.error.errors.forEach((err) => {
          errors.push({
            rowNumber: rowNum,
            field: String(err.path[0] || 'unknown'),
            message: err.message,
          });
        });
      }
    });

    const invalidCount = invalidRows.size;
    return {
      records,
      errors: errors.slice(0, 100), // Limit errors returned
      stats: {
        total: recordsToProcess.length,
        valid: records.length,
        invalid: invalidCount,
        errorRate: recordsToProcess.length > 0 ? Math.round((invalidCount / recordsToProcess.length) * 100) : 0,
      },
      warnings,
    };
  }

  static parseEmailList(content: string): ImportResult {
    const records: ParsedContact[] = [];
    const errors: ImportResult['errors'] = [];
    const warnings: string[] = [];
    const seenEmails = new Set<string>();
    let invalidCount = 0;

    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, IMPORT_LIMITS.MAX_RECORDS);

    if (content.split('\n').filter(l => l.trim()).length > IMPORT_LIMITS.MAX_RECORDS) {
      warnings.push(`File contains more than ${IMPORT_LIMITS.MAX_RECORDS} lines. Only first ${IMPORT_LIMITS.MAX_RECORDS} will be processed.`);
    }

    lines.forEach((line, idx) => {
      const email = normalizeEmail(line);
      
      if (!email) {
        invalidCount++;
        errors.push({
          rowNumber: idx + 1,
          field: 'email',
          message: 'Invalid email format',
        });
        return;
      }

      // Deduplicate within import
      if (seenEmails.has(email)) {
        warnings.push(`Line ${idx + 1}: Duplicate email "${email}" - skipped`);
        return;
      }

      seenEmails.add(email);
      records.push({ email });
    });

    return {
      records,
      errors: errors.slice(0, 100),
      stats: {
        total: lines.length,
        valid: records.length,
        invalid: invalidCount,
        errorRate: lines.length > 0 ? Math.round((invalidCount / lines.length) * 100) : 0,
      },
      warnings,
    };
  }

  static parseJSON(content: string): ImportResult {
    const records: ParsedContact[] = [];
    const errors: ImportResult['errors'] = [];
    const warnings: string[] = [];
    const emailToIndex = new Map<string, number>();
    const phoneToIndex = new Map<string, number>();
    const companyCityToIndex = new Map<string, number>();
    let invalidCount = 0;

    // Guard rail: Check content size
    const sizeInMB = Buffer.byteLength(content, 'utf8') / (1024 * 1024);
    if (sizeInMB > IMPORT_LIMITS.MAX_FILE_SIZE_MB) {
      return {
        records: [],
        errors: [{ rowNumber: 0, field: 'file', message: `File exceeds ${IMPORT_LIMITS.MAX_FILE_SIZE_MB}MB limit` }],
        stats: { total: 0, valid: 0, invalid: 1, errorRate: 100 },
        warnings: [],
      };
    }

    try {
      const parsed = JSON.parse(content);
      const data = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, IMPORT_LIMITS.MAX_RECORDS);

      if (Array.isArray(parsed) && parsed.length > IMPORT_LIMITS.MAX_RECORDS) {
        warnings.push(`JSON contains ${parsed.length} records. Only first ${IMPORT_LIMITS.MAX_RECORDS} will be processed.`);
      }

      data.forEach((item, idx) => {
        const mapped = this.normalizeFields(item);
        
        // Self-healing: Normalize canonical fields
        if (mapped.email) {
          mapped.email = normalizeEmail(mapped.email);
        }
        if (mapped.phone) {
          const e164 = normalizePhoneE164(mapped.phone);
          mapped.phone = e164 || normalizePhone(mapped.phone);
        }
        if (mapped.websiteUrl) {
          const normalizedUrl = normalizeWebsiteUrl(mapped.websiteUrl);
          mapped.websiteUrl = normalizedUrl || undefined;
        }
        if (mapped.city) {
          const normalizedCity = normalizeCity(mapped.city);
          mapped.city = normalizedCity || undefined;
        }

        // Deduplicate with NO-LOSS MERGE: phone_norm > email > company+city
        const phoneNorm = mapped.phone ? normPhone(mapped.phone) : null;
        const companyNorm = mapped.company ? normCompany(mapped.company) : null;
        const cityNorm = mapped.city ? mapped.city.toLowerCase().trim() : null;
        const companyCityKey = companyNorm && cityNorm ? `${companyNorm}|${cityNorm}` : null;
        
        // Check if this is a duplicate and find the index of the existing record to merge
        let existingIndex: number | undefined;
        let mergeReason: string | undefined;
        
        if (mapped.email && emailToIndex.has(mapped.email)) {
          existingIndex = emailToIndex.get(mapped.email);
          mergeReason = `email "${mapped.email}"`;
        } else if (phoneNorm && phoneToIndex.has(phoneNorm)) {
          existingIndex = phoneToIndex.get(phoneNorm);
          mergeReason = `phone`;
        } else if (companyCityKey && companyCityToIndex.has(companyCityKey)) {
          existingIndex = companyCityToIndex.get(companyCityKey);
          mergeReason = `company+city`;
        }
        
        // If duplicate found, merge into existing record instead of skipping
        if (existingIndex !== undefined && existingIndex < records.length) {
          const existingRecord = records[existingIndex];
          const merged = mergeContacts(existingRecord, mapped);
          records[existingIndex] = merged;
          warnings.push(`Record ${idx + 1}: Duplicate by ${mergeReason} - merged`);
          return;
        }

        const result = ContactSchema.safeParse(mapped);

        if (result.success) {
          const recordIndex = records.length;
          records.push(result.data);
          
          // Track all identifiers for this record for future merges
          if (result.data.email) {
            emailToIndex.set(result.data.email, recordIndex);
          }
          if (phoneNorm) {
            phoneToIndex.set(phoneNorm, recordIndex);
          }
          if (companyCityKey) {
            companyCityToIndex.set(companyCityKey, recordIndex);
          }
        } else {
          invalidCount++;
          errors.push({
            rowNumber: idx + 1,
            field: 'json',
            message: result.error.errors.map(e => e.message).join(', '),
          });
        }
      });

      return {
        records,
        errors: errors.slice(0, 100),
        stats: {
          total: data.length,
          valid: records.length,
          invalid: invalidCount,
          errorRate: data.length > 0 ? Math.round((invalidCount / data.length) * 100) : 0,
        },
        warnings,
      };
    } catch (e) {
      return {
        records: [],
        errors: [{ rowNumber: 0, field: 'json', message: 'Invalid JSON syntax' }],
        stats: { total: 0, valid: 0, invalid: 1, errorRate: 100 },
        warnings: [],
      };
    }
  }

  static detectFormat(content: string): 'csv' | 'json' | 'email_list' {
    const trimmed = content.trim();
    
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return 'json';
    }
    
    // Check if it looks like CSV (has commas in first line and consistent structure)
    const firstLine = trimmed.split('\n')[0];
    if (firstLine.includes(',') && firstLine.split(',').length >= 2) {
      return 'csv';
    }
    
    return 'email_list';
  }

  static parse(content: string, format?: string): ImportResult {
    const detectedFormat = format || this.detectFormat(content);
    
    switch (detectedFormat) {
      case 'csv':
        return this.parseCSV(content);
      case 'json':
        return this.parseJSON(content);
      default:
        return this.parseEmailList(content);
    }
  }

  private static mapRow(row: Record<string, string>): Partial<ParsedContact> {
    const contact: Partial<ParsedContact> = {};
    const mapping: Record<string, string[]> = {
      firstName: ['first_name', 'firstname', 'first', 'fname', 'given_name'],
      lastName: ['last_name', 'lastname', 'last', 'lname', 'surname', 'family_name'],
      email: ['email', 'e_mail', 'email_address', 'emailaddress', 'mail', 'emails'],
      phone: ['phone', 'phone_number', 'mobile', 'telephone', 'cell', 'phonenumber'],
      title: ['title', 'job_title', 'position', 'role', 'jobtitle'],
      company: ['company', 'company_name', 'organization', 'org', 'employer', 'business', 'business_name', 'place_name'],
      companyDomain: ['domain', 'company_domain'],
      websiteUrl: ['website', 'website_url', 'url', 'web', 'site', 'site_url'],
      linkedinUrl: ['linkedin', 'linkedin_url', 'linkedin_profile', 'linkedinurl'],
      city: ['city', 'town', 'metro'],
      state: ['state', 'state_code', 'province', 'region'],
      address: ['address', 'street_address', 'formatted_address', 'full_address', 'location'],
      category: ['category', 'type', 'primary_category', 'business_type', 'industry'],
    };

    Object.entries(row).forEach(([key, value]) => {
      if (!value || typeof value !== 'string') return;
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
      for (const [field, patterns] of Object.entries(mapping)) {
        if (patterns.some((p) => normalizedKey.includes(p.replace(/[^a-z]/g, '')))) {
          contact[field as keyof ParsedContact] = sanitizeString(value);
          break;
        }
      }
    });

    return contact;
  }

  private static normalizeFields(obj: Record<string, unknown>): Partial<ParsedContact> {
    const contact: Partial<ParsedContact> = {};
    const fieldMap: Record<string, string[]> = {
      firstName: ['first_name', 'firstname', 'fname', 'first', 'given_name'],
      lastName: ['last_name', 'lastname', 'lname', 'last', 'surname'],
      email: ['email', 'e_mail', 'email_address', 'mail', 'emails'],
      phone: ['phone', 'phone_number', 'mobile', 'cell'],
      title: ['title', 'job_title', 'position', 'role'],
      company: ['company', 'company_name', 'organization', 'org', 'business', 'business_name', 'place_name'],
      companyDomain: ['domain', 'company_domain'],
      websiteUrl: ['website', 'website_url', 'url', 'web', 'site'],
      linkedinUrl: ['linkedin', 'linkedin_url', 'linkedinurl'],
      city: ['city', 'town', 'metro'],
      state: ['state', 'state_code', 'province', 'region'],
      address: ['address', 'street_address', 'formatted_address', 'full_address', 'location'],
      category: ['category', 'type', 'primary_category', 'business_type', 'industry'],
    };

    Object.keys(obj).forEach((key) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
      const value = obj[key];

      if (typeof value !== 'string') return;

      for (const [field, patterns] of Object.entries(fieldMap)) {
        if (patterns.some((p) => normalizedKey.includes(p.replace(/[^a-z]/g, '')))) {
          contact[field as keyof ParsedContact] = sanitizeString(value);
          break;
        }
      }
    });

    return contact;
  }
}
